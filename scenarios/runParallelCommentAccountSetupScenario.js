import {
    isValidCommentAccountPersona,
    normalizeGeoCode,
} from "../services/personas/CommentAccountPersonaGenerator.js";
import getCommentAccountSetupSkipReason, {
    commentAccountSetupSkipReasons,
    describeCommentAccountSetupSkipReason,
} from "../services/accounts/getCommentAccountSetupSkipReason.js";
import { takeNextPhotoSet } from "../services/accounts/photoSets.js";
import saveCommentAccountSetupReport from "../services/reports/saveCommentAccountSetupReport.js";
import executeCommentAccountSetupWithProfile from "../workflows/accounts/executeCommentAccountSetupWithProfile.js";
import {
    KeyedMutex,
    normalizeConcurrency,
} from "./runParallelCommentingScenario.js";


function createAbortError() {
    return Object.assign(new Error("Оформлення акаунтів перервано"), {
        name: "AbortError",
        code: "ACCOUNT_SETUP_ABORTED",
    });
}


function createScenarioLogger(logger) {
    const target = typeof logger?.child === "function"
        ? logger.child("accounts.setup")
        : logger;
    const write = (level, event, message, fields = {}) => {
        const method = typeof target?.[level] === "function"
            ? target[level].bind(target)
            : console[level === "debug" ? "log" : level].bind(console);
        if (typeof target?.child === "function") method(event, message, fields);
        else method(message, fields);
    };
    return {
        debug: (event, message, fields) => write("debug", event, message, fields),
        info: (event, message, fields) => write("info", event, message, fields),
        warn: (event, message, fields) => write("warn", event, message, fields),
        error: (event, message, fields) => write("error", event, message, fields),
    };
}


function normalizeProfileNos(profileNos) {
    if (!Array.isArray(profileNos) || profileNos.length === 0) {
        throw new Error("Потрібен непорожній список номерів профілів AdsPower");
    }

    const unique = [];
    const seen = new Set();

    for (const value of profileNos) {
        const profileNo = String(value ?? "").trim();
        if (!profileNo) {
            throw new Error("У списку профілів є порожній номер");
        }
        if (seen.has(profileNo)) continue;
        seen.add(profileNo);
        unique.push(profileNo);
    }

    return unique;
}


function normalizePersonas(personas) {
    if (!Array.isArray(personas) || personas.length === 0) {
        throw new Error("Потрібен непорожній JSON зі списком персонажів");
    }

    return personas.map((persona, index) => {
        if (!isValidCommentAccountPersona(persona)) {
            throw new Error(`Персонаж №${index + 1} має некоректні поля`);
        }

        return {
            gender: persona.gender,
            firstName: String(persona.firstName).trim(),
            lastName: String(persona.lastName).trim(),
            bio: String(persona.bio ?? "").trim(),
            education: String(persona.education).trim(),
            work: {
                company: String(persona.work.company).trim(),
                position: String(persona.work.position).trim(),
            },
        };
    });
}


function createReport({
    geo,
    profileNos,
    personaCount,
    photosDirectory,
    browserMode,
    disableImages,
    concurrency,
}) {
    return {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        geo,
        profileNos,
        personaCount,
        photosDirectory: photosDirectory || null,
        browserMode: browserMode === "headless" ? "headless" : "visible",
        disableImages: disableImages === true,
        concurrency,
        mode: "parallel",
        interrupted: false,
        fatalError: null,
        reportPath: null,
        profiles: [],
        cleanupWarnings: [],
    };
}


export default async function runParallelCommentAccountSetupScenario({
    adsPower,
    profileNos,
    personas,
    geo,
    photosDirectory = null,
    browserMode = "visible",
    disableImages = false,
    concurrency = 5,
    workerProxies = null,
    onProxyUnavailable = null,
    logger,
    signal,
    onProgress,
    reportsDirectory = "./data/reports",
    executeSetup = executeCommentAccountSetupWithProfile,
    takePhotoSet = takeNextPhotoSet,
    skipNameChange = false,
    skipAvatarChange = false,
    skipCoverChange = false,
    skipDeletePosts = false,
    skipPublishPosts = false,
    skipFillAbout = false,
    ignoreSkipReasons = false,
} = {}) {
    const workerLimit = normalizeConcurrency(concurrency);
    const workerProxyMap = workerProxies && typeof workerProxies === "object"
        ? new Map(Object.entries(workerProxies)
            .map(([workerId, proxy]) => [Number(workerId), proxy])
            .filter(([workerId, proxy]) => (
                Number.isInteger(workerId)
                && workerId >= 1
                && workerId <= workerLimit
                && proxy
                && String(proxy.type ?? "").toLowerCase() !== "no_proxy"
            )))
        : null;
    const scenarioLogger = createScenarioLogger(logger);
    const normalizedGeo = normalizeGeoCode(geo);
    const normalizedProfileNos = normalizeProfileNos(profileNos);
    const normalizedPersonas = normalizePersonas(personas);
    const report = createReport({
        geo: normalizedGeo,
        profileNos: normalizedProfileNos,
        personaCount: normalizedPersonas.length,
        photosDirectory,
        browserMode,
        disableImages,
        concurrency: workerProxyMap ? workerProxyMap.size : workerLimit,
    });
    const profileMutex = new KeyedMutex();
    const assignMutex = new KeyedMutex();
    const runningOperations = new Set();
    const personaQueue = [...normalizedPersonas];
    const ready = [...normalizedProfileNos];
    let progressQueue = Promise.resolve();
    let activeAttempts = 0;
    let abortError = null;

    const progress = (payload) => {
        if (typeof onProgress !== "function") return Promise.resolve();
        const counts = {
            success: report.profiles.filter((item) => item.outcome === "success").length,
            completedWithError: report.profiles.filter((item) =>
                item.outcome === "completed_with_error"
            ).length,
            failed: report.profiles.filter((item) => item.outcome === "failed").length,
            skipped: report.profiles.filter((item) => item.outcome === "skipped").length,
        };
        const event = {
            completed: report.profiles.length,
            total: normalizedProfileNos.length,
            activeWorkers: activeAttempts,
            concurrency: report.concurrency,
            ...counts,
            ...payload,
        };
        const invoke = () => onProgress(event);
        const result = progressQueue.then(invoke, invoke);
        progressQueue = result.catch(() => {});
        return result;
    };
    const assertNotAborted = () => {
        if (signal?.aborted) throw createAbortError();
    };
    const saveCleanupWarnings = (result) => {
        (result.cleanupErrors ?? []).forEach((error) => {
            report.cleanupWarnings.push({
                profileNo: result.profileNo,
                error,
            });
        });
    };
    const toReportItem = (result, extra = {}) => ({
        profileNo: result.profileNo,
        outcome: result.outcome,
        skipReason: result.skipReason ?? extra.skipReason ?? null,
        error: result.error ?? extra.error ?? null,
        stage: result.stage ?? extra.stage ?? null,
        persona: result.persona ?? extra.persona ?? null,
        adsPowerName: result.adsPowerName ?? null,
        photoFolder: result.photoFolder ?? extra.photoFolder ?? null,
        renamedPhotoFolder: result.renamedPhotoFolder ?? null,
        steps: result.steps ?? extra.steps ?? null,
        workerId: extra.workerId ?? null,
    });

    try {
        assertNotAborted();
        if (workerProxyMap && workerProxyMap.size === 0) {
            throw new Error("Немає воркерів із призначеною проксі");
        }

        scenarioLogger.info(
            "scenario.started",
            "Оформлення акаунтів під коментарі розпочато",
            {
                geo: normalizedGeo,
                profiles: normalizedProfileNos.length,
                personas: normalizedPersonas.length,
                concurrency: report.concurrency,
            }
        );

        const processProfile = async (profileNo, workerId) => {
            assertNotAborted();
            return profileMutex.run(profileNo, async () => {
                activeAttempts += 1;
                await progress({
                    stage: "profile",
                    currentProfileNo: profileNo,
                    workerId,
                    message: `Worker ${workerId} · профіль ${profileNo}`,
                });

                let photoSet = null;
                let persona = null;
                try {
                    let profile;
                    try {
                        profile = await adsPower.getProfileByNo(profileNo);
                    } catch (error) {
                        report.profiles.push(toReportItem({
                            profileNo,
                            outcome: "failed",
                            error: error.message,
                            stage: "LOAD_PROFILE",
                            persona: null,
                            adsPowerName: null,
                            steps: null,
                        }, { workerId }));
                        return;
                    }

                    const skipReason = getCommentAccountSetupSkipReason(profile);
                    const ignoredSkipReasons = new Set([
                        commentAccountSetupSkipReasons.ALREADY_SETUP,
                        commentAccountSetupSkipReasons.CHANGE_NAME_ERROR,
                    ]);
                    if (
                        skipReason
                        && !(
                            ignoreSkipReasons
                            && ignoredSkipReasons.has(skipReason)
                        )
                    ) {
                        report.profiles.push(toReportItem({
                            profileNo,
                            outcome: "skipped",
                            skipReason: describeCommentAccountSetupSkipReason(
                                skipReason
                            ),
                            stage: "SKIP",
                            persona: null,
                            adsPowerName: null,
                            steps: null,
                        }, { workerId }));
                        return;
                    }

                    const assigned = await assignMutex.run("next", async () => {
                        const nextPersona = personaQueue.shift() ?? null;
                        if (!nextPersona) {
                            return { persona: null, photoSet: null };
                        }

                        const nextPhotoSet = photosDirectory
                            ? await takePhotoSet(
                                photosDirectory,
                                nextPersona.gender,
                                profileNo
                            )
                            : null;
                        return {
                            persona: nextPersona,
                            photoSet: nextPhotoSet,
                        };
                    });
                    persona = assigned.persona;
                    photoSet = assigned.photoSet;
                    if (!persona) {
                        report.profiles.push(toReportItem({
                            profileNo,
                            outcome: "skipped",
                            skipReason: "Немає вільних персонажів у JSON",
                            stage: "SKIP",
                            persona: null,
                            adsPowerName: null,
                            steps: null,
                        }, { workerId }));
                        return;
                    }

                    const result = await executeSetup({
                        adsPower,
                        profile,
                        persona,
                        photoSet,
                        skipNameChange,
                        skipAvatarChange,
                        skipCoverChange,
                        skipDeletePosts,
                        skipPublishPosts,
                        skipFillAbout,
                        ignoreSkipReasons,
                        browserMode: report.browserMode,
                        disableImages: report.disableImages,
                        workerId,
                        workerProxy: workerProxyMap?.get(workerId) ?? null,
                        onProxyUnavailable: workerProxyMap
                            && typeof onProxyUnavailable === "function"
                            ? async (info) => {
                                const action = await onProxyUnavailable(info);
                                if (action?.type === "replace" && action.proxy) {
                                    workerProxyMap.set(
                                        Number(info.workerId),
                                        action.proxy
                                    );
                                }
                                return action;
                            }
                            : null,
                        logger: logger?.child?.("account.setup", {
                            profileNo,
                            workerId,
                        }) ?? logger,
                        signal,
                    });
                    saveCleanupWarnings(result);

                    if (result.skippedDueToProxy) {
                        await assignMutex.run("next", async () => {
                            if (persona) personaQueue.unshift(persona);
                        });
                        report.profiles.push(toReportItem({
                            ...result,
                            outcome: "skipped",
                            skipReason: result.error,
                            persona: null,
                        }, { workerId, persona: null }));
                        return;
                    }

                    report.profiles.push(toReportItem(result, {
                        workerId,
                        persona,
                        photoFolder: photoSet?.path ?? null,
                    }));
                } finally {
                    activeAttempts -= 1;
                    await progress({
                        stage: "profile",
                        workerId,
                        currentProfileNo: profileNo,
                        message: `Оброблено профіль ${profileNo}`,
                    });
                }
            });
        };

        const freeWorkerIds = workerProxyMap
            ? [...workerProxyMap.keys()].sort((left, right) => left - right)
            : Array.from({ length: workerLimit }, (_, index) => index + 1);

        while ((ready.length || runningOperations.size) && !signal?.aborted) {
            while (ready.length && freeWorkerIds.length && !signal?.aborted) {
                const profileNo = ready.shift();
                const workerId = freeWorkerIds.shift();
                let operation;
                operation = processProfile(profileNo, workerId)
                    .catch((error) => {
                        if (error?.name === "AbortError") throw error;
                        report.profiles.push(toReportItem({
                            profileNo,
                            outcome: "failed",
                            error: error.message,
                            stage: "WORKER",
                            persona: null,
                            adsPowerName: null,
                            steps: null,
                        }, { workerId }));
                    })
                    .finally(() => {
                        freeWorkerIds.push(workerId);
                        runningOperations.delete(operation);
                    });
                runningOperations.add(operation);
            }
            if (runningOperations.size) await Promise.race(runningOperations);
        }

        if (signal?.aborted) throw createAbortError();
        await Promise.all(runningOperations);
        await progress({
            stage: "done",
            message: "Усі профілі оброблено",
        });
    } catch (error) {
        report.fatalError = error.message;
        report.interrupted = signal?.aborted || error?.name === "AbortError";
        scenarioLogger.error(
            "scenario.failed",
            "Оформлення акаунтів завершилося помилкою",
            {
                interrupted: report.interrupted,
                error,
            }
        );
        if (report.interrupted) abortError = error;
    } finally {
        await Promise.allSettled(runningOperations);
        report.finishedAt = new Date().toISOString();
        try {
            report.reportPath = await saveCommentAccountSetupReport(
                report,
                reportsDirectory
            );
        } catch (error) {
            scenarioLogger.error(
                "report.failed",
                "Не вдалося зберегти markdown-звіт",
                { error }
            );
            report.cleanupWarnings.push({
                profileNo: "—",
                error: `Звіт: ${error.message}`,
            });
        }
        await progressQueue;
    }

    if (abortError) {
        abortError.report = report;
        throw abortError;
    }

    return { report };
}
