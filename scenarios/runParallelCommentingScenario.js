import getProfileGender from "../services/profile/getProfileGender.js";
import executeCommentWithProfile from "../workflows/comments/executeCommentWithProfile.js";
import {
    createReport,
    getActionType,
    getCommentLabel,
    normalizeComment,
    normalizeGroupIds,
    shuffleArray,
    validateSettings,
} from "./runCommentingScenario.js";


function normalizeConcurrency(value) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(5, Math.max(1, Math.round(number)))
        : 5;
}


function createAbortError() {
    return Object.assign(new Error("Паралельне коментування перервано"), {
        name: "AbortError",
        code: "COMMENTING_ABORTED",
    });
}


function createScenarioLogger(logger) {
    const target = typeof logger?.child === "function"
        ? logger.child("comments.parallel")
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


class KeyedMutex {
    #tails = new Map();


    async run(key, operation) {
        if (!key) return operation();
        const previous = this.#tails.get(key) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        this.#tails.set(key, current);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.#tails.get(key) === current) this.#tails.delete(key);
        }
    }
}


/**
 * Паралельна версія сценарію коментування.
 * Reply стає доступним одразу після успішного завершення його parent-коментаря.
 */
export default async function runParallelCommentingScenario({
    adsPower,
    groupIds,
    comments,
    geo,
    creativeName,
    postUrl,
    browserMode = "visible",
    disableImages = false,
    concurrency = 5,
    workerProxies = null,
    onProxyUnavailable = null,
    logger,
    signal,
    onProgress,
    executeComment = executeCommentWithProfile,
    getGender = getProfileGender,
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
    const report = {
        ...createReport({
            groupIds,
            geo,
            creativeName,
            postUrl,
            browserMode,
            disableImages,
        }),
        mode: "parallel",
        concurrency: workerProxyMap ? workerProxyMap.size : workerLimit,
        interrupted: false,
        totalComments: Array.isArray(comments) ? comments.length : 0,
        maximumParallelism: 0,
    };
    const profileKeyMap = new Map();
    const brokenProfileKeys = new Set();
    const attemptedProfileNos = new Set();
    const publishedCommentIds = new Set();
    const profileKeyMutex = new KeyedMutex();
    const profileMutex = new KeyedMutex();
    const runningOperations = new Set();
    let progressQueue = Promise.resolve();
    let activeAttempts = 0;
    let abortError = null;

    const completedCount = () => report.published.length
        + report.skipped.length
        + report.failedComments.length;
    const progress = (payload) => {
        if (typeof onProgress !== "function") return Promise.resolve();
        const event = {
            completed: completedCount(),
            total: report.totalComments,
            published: report.published.length,
            skipped: report.skipped.length,
            failedComments: report.failedComments.length,
            failedProfiles: report.failedProfiles.length,
            activeWorkers: activeAttempts,
            concurrency: report.concurrency,
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
                commentId: result.commentId,
                error,
            });
        });
    };

    try {
        assertNotAborted();
        validateSettings({ groupIds, comments, geo, creativeName, postUrl });
        const normalizedComments = comments.map(normalizeComment);
        const commentsById = new Map();
        const duplicateRows = new Set();

        normalizedComments.forEach((comment) => {
            if (!comment.id || commentsById.has(comment.id)) {
                duplicateRows.add(comment.rowNumber);
                return;
            }
            commentsById.set(comment.id, comment);
        });

        await progress({
            stage: "profiles",
            message: "Завантажуємо та перемішуємо AdsPower-профілі",
        });
        const normalizedGroupIds = normalizeGroupIds(groupIds);
        const profilesFromGroups = await Promise.all(
            normalizedGroupIds.map((groupId) => adsPower.getProfilesByGroupId(groupId))
        );
        assertNotAborted();

        const uniqueProfiles = [];
        const seenProfileNos = new Set();
        profilesFromGroups.flat().forEach((profile) => {
            const profileNo = String(profile?.profile_no ?? "").trim();
            if (!profileNo || seenProfileNos.has(profileNo)) return;
            seenProfileNos.add(profileNo);
            uniqueProfiles.push(profile);
        });
        const profiles = shuffleArray(uniqueProfiles);
        if (!profiles.length) {
            throw new Error(`Групи AdsPower ${normalizedGroupIds.join(", ")} порожні або не існують`);
        }

        const profilesByNo = new Map();
        const profilePools = { male: [], female: [] };
        profiles.forEach((profile) => {
            const profileNo = String(profile?.profile_no ?? "").trim();
            const gender = getGender(profile);
            if (!gender || !profilePools[gender]) {
                report.excludedProfiles.push({
                    profileNo: profileNo || "невідомий",
                    reason: "Відсутній або неоднозначний гендерний тег",
                });
                return;
            }
            profilesByNo.set(profileNo, profile);
            profilePools[gender].push(profile);
        });

        scenarioLogger.info("profiles.ready", "Профілі для паралельного коментування підготовлено", {
            groups: normalizedGroupIds,
            total: profilesByNo.size,
            male: profilePools.male.length,
            female: profilePools.female.length,
            concurrency: workerLimit,
        });

        const runnable = new Map();
        const skipStatic = (comment, reason) => {
            report.skipped.push({
                commentId: getCommentLabel(comment),
                reason,
                text: comment.text,
            });
        };
        normalizedComments.forEach((comment) => {
            if (comment.should_write === false) {
                skipStatic(comment, "should_write=false");
            } else if (comment.should_write !== true) {
                skipStatic(comment, "Некоректне значення should_write");
            } else if (!comment.id || duplicateRows.has(comment.rowNumber)) {
                skipStatic(comment, !comment.id ? "Відсутній ID коментаря" : "ID коментаря дублюється");
            } else if (typeof comment.text !== "string" || !comment.text.trim()) {
                skipStatic(comment, "Відсутній текст коментаря");
            } else if (!profilePools[comment.gender]) {
                skipStatic(comment, "Не вказано коректний gender");
            } else if (comment.parent_id !== null && !commentsById.has(comment.parent_id)) {
                skipStatic(comment, `Не знайдено parent_id=${comment.parent_id}`);
            } else {
                runnable.set(comment.id, comment);
            }
        });

        const childrenByParentId = new Map();
        runnable.forEach((comment) => {
            if (comment.parent_id === null) return;
            const children = childrenByParentId.get(comment.parent_id) ?? [];
            children.push(comment);
            childrenByParentId.set(comment.parent_id, children);
        });

        const ready = [];
        const queuedIds = new Set();
        const terminalIds = new Set();
        const enqueue = (comment) => {
            if (!comment || queuedIds.has(comment.id) || terminalIds.has(comment.id)) return;
            queuedIds.add(comment.id);
            ready.push(comment);
        };
        runnable.forEach((comment) => {
            const parent = comment.parent_id === null
                ? null
                : commentsById.get(comment.parent_id);
            if (comment.parent_id === null || parent?.should_write === false) enqueue(comment);
        });

        const takeNextProfile = (gender) => {
            const profile = profilePools[gender].find((candidate) => (
                !attemptedProfileNos.has(String(candidate.profile_no))
            )) ?? null;
            if (profile) attemptedProfileNos.add(String(profile.profile_no));
            return profile;
        };
        const recordFailure = (comment, reason, attempts) => {
            if (terminalIds.has(comment.id)) return;
            terminalIds.add(comment.id);
            report.failedComments.push({
                commentId: comment.id,
                actionType: getActionType(comment),
                reason,
                attempts,
                text: comment.text,
            });
            scenarioLogger.warn("comment.failed", "Коментар не опубліковано", {
                commentId: comment.id,
                actionType: getActionType(comment),
                attempts,
                reason,
            });
        };
        const skipDescendants = (parentId, reason) => {
            for (const child of childrenByParentId.get(parentId) ?? []) {
                if (terminalIds.has(child.id)) continue;
                terminalIds.add(child.id);
                report.skipped.push({
                    commentId: child.id,
                    reason,
                    text: child.text,
                });
                skipDescendants(
                    child.id,
                    `Батьківський коментар ${child.id} не опубліковано`
                );
            }
        };
        const executeAttempt = async (profile, comment, parentComment, workerId) => {
            const profileNo = String(profile.profile_no);
            return profileMutex.run(profileNo, async () => {
                assertNotAborted();
                activeAttempts += 1;
                report.maximumParallelism = Math.max(report.maximumParallelism, activeAttempts);
                scenarioLogger.info("comment.started", "Worker почав коментар", {
                    workerId,
                    commentId: comment.id,
                    actionType: getActionType(comment),
                    profileNo,
                });
                await progress({
                    stage: "comments",
                    currentCommentId: comment.id,
                    currentProfileNo: profileNo,
                    workerId,
                    message: `Worker ${workerId} · коментар ${comment.id}`,
                });
                try {
                    const result = await executeComment({
                        adsPower,
                        profile,
                        postUrl,
                        comment,
                        parentComment,
                        browserMode: report.browserMode,
                        disableImages: report.disableImages,
                        workerId,
                        workerProxy: workerProxyMap?.get(workerId) ?? null,
                        onProxyUnavailable: workerProxyMap && typeof onProxyUnavailable === "function"
                            ? async (info) => {
                                const action = await onProxyUnavailable(info);
                                if (action?.type === "replace" && action.proxy) {
                                    workerProxyMap.set(Number(info.workerId), action.proxy);
                                }
                                return action;
                            }
                            : null,
                        logger: logger?.child?.("comment", {
                            commentId: comment.id,
                            profileNo,
                            workerId,
                        }) ?? logger,
                        signal,
                    });
                    saveCleanupWarnings(result);
                    if (result.skippedDueToProxy) {
                        return result;
                    }
                    if (!result.success && !result.aborted) {
                        report.failedProfiles.push({
                            profileNo,
                            commentId: comment.id,
                            stage: result.stage,
                            error: result.error,
                        });
                    }
                    return result;
                } finally {
                    activeAttempts -= 1;
                }
            });
        };
        const publishWithProfile = async (comment, parentComment, workerId) => {
            if (comment.profile_key && brokenProfileKeys.has(comment.profile_key)) {
                return {
                    published: false,
                    attempts: 0,
                    reason: `profile_key=${comment.profile_key} недоступний`,
                };
            }

            if (comment.profile_key && profileKeyMap.has(comment.profile_key)) {
                const profileNo = profileKeyMap.get(comment.profile_key);
                const profile = profilesByNo.get(profileNo);
                if (getGender(profile) !== comment.gender) {
                    return {
                        published: false,
                        attempts: 0,
                        reason: `Стать profile_key=${comment.profile_key} не відповідає gender=${comment.gender}`,
                    };
                }
                const result = await executeAttempt(profile, comment, parentComment, workerId);
                if (result.aborted) throw createAbortError();
                if (result.skippedDueToProxy) {
                    return {
                        published: false,
                        skippedDueToProxy: true,
                        attempts: 1,
                        reason: result.error || "Коментар пропущено через проксі воркера",
                    };
                }
                if (result.success) return { published: true, attempts: 1, profile };
                brokenProfileKeys.add(comment.profile_key);
                return {
                    published: false,
                    attempts: 1,
                    reason: `Прив'язаний профіль ${profileNo} завершився помилкою: ${result.error}`,
                };
            }

            let attempts = 0;
            let lastError = null;
            while (true) {
                assertNotAborted();
                const profile = takeNextProfile(comment.gender);
                if (!profile) break;
                attempts += 1;
                const result = await executeAttempt(profile, comment, parentComment, workerId);
                if (result.aborted) throw createAbortError();
                if (result.skippedDueToProxy) {
                    return {
                        published: false,
                        skippedDueToProxy: true,
                        attempts,
                        reason: result.error || "Коментар пропущено через проксі воркера",
                    };
                }
                if (result.success) {
                    if (comment.profile_key) {
                        profileKeyMap.set(comment.profile_key, String(profile.profile_no));
                    }
                    return { published: true, attempts, profile };
                }
                lastError = result.error;
                if (getActionType(comment) === "reply") break;
            }
            return {
                published: false,
                attempts,
                reason: lastError
                    ? getActionType(comment) === "reply"
                        ? `Не вдалося опублікувати reply: ${lastError}`
                        : `Усі спроби завершилися помилкою: ${lastError}`
                    : `Закінчилися профілі gender=${comment.gender}`,
            };
        };
        const processComment = async (comment, workerId) => {
            queuedIds.delete(comment.id);
            assertNotAborted();
            const parentComment = comment.parent_id === null
                ? null
                : commentsById.get(comment.parent_id);
            const execute = () => publishWithProfile(comment, parentComment, workerId);
            const outcome = comment.profile_key
                ? await profileKeyMutex.run(comment.profile_key, execute)
                : await execute();

            if (outcome.skippedDueToProxy) {
                if (!terminalIds.has(comment.id)) {
                    terminalIds.add(comment.id);
                    report.skipped.push({
                        commentId: comment.id,
                        reason: outcome.reason,
                        text: comment.text,
                    });
                }
                skipDescendants(
                    comment.id,
                    `Батьківський коментар ${comment.id} не опубліковано`
                );
            } else if (!outcome.published) {
                recordFailure(comment, outcome.reason, outcome.attempts);
                skipDescendants(
                    comment.id,
                    `Батьківський коментар ${comment.id} не опубліковано`
                );
            } else {
                terminalIds.add(comment.id);
                publishedCommentIds.add(comment.id);
                report.published.push({
                    commentId: comment.id,
                    actionType: getActionType(comment),
                    profileNo: String(outcome.profile.profile_no),
                    gender: comment.gender,
                    profileKey: comment.profile_key,
                    text: comment.text,
                });
                scenarioLogger.info("comment.published", "Коментар успішно опубліковано", {
                    workerId,
                    commentId: comment.id,
                    actionType: getActionType(comment),
                    profileNo: String(outcome.profile.profile_no),
                });
                for (const child of childrenByParentId.get(comment.id) ?? []) enqueue(child);
            }
            await progress({
                stage: "comments",
                workerId,
                message: `Оброблено коментар ${comment.id}`,
            });
        };

        scenarioLogger.info("scenario.started", "Паралельне коментування розпочато", {
            comments: normalizedComments.length,
            runnable: runnable.size,
            concurrency: workerLimit,
        });
        if (workerProxyMap && workerProxyMap.size === 0) {
            throw new Error("Немає воркерів із призначеною проксі");
        }
        const freeWorkerIds = workerProxyMap
            ? [...workerProxyMap.keys()].sort((left, right) => left - right)
            : Array.from({ length: workerLimit }, (_, index) => index + 1);
        while ((ready.length || runningOperations.size) && !signal?.aborted) {
            while (ready.length && freeWorkerIds.length && !signal?.aborted) {
                const comment = ready.shift();
                const workerId = freeWorkerIds.shift();
                let operation;
                operation = processComment(comment, workerId)
                    .catch((error) => {
                        if (error?.name === "AbortError") throw error;
                        recordFailure(comment, error.message, 0);
                        skipDescendants(comment.id, `Батьківський коментар ${comment.id} не опубліковано`);
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

        runnable.forEach((comment) => {
            if (terminalIds.has(comment.id) || queuedIds.has(comment.id)) return;
            terminalIds.add(comment.id);
            report.skipped.push({
                commentId: comment.id,
                reason: "Залежність не виконана або в дереві коментарів є цикл",
                text: comment.text,
            });
        });
        await progress({ stage: "comments", message: "Усі доступні коментарі оброблено" });
    } catch (error) {
        report.fatalError = error.message;
        report.interrupted = signal?.aborted || error?.name === "AbortError";
        scenarioLogger.error("scenario.failed", "Паралельне коментування завершилося помилкою", {
            interrupted: report.interrupted,
            error,
        });
        if (report.interrupted) abortError = error;
    } finally {
        await Promise.allSettled(runningOperations);
        report.finishedAt = new Date().toISOString();
        report.profileKeyMap = Object.fromEntries(profileKeyMap);
        await progress({ stage: "report", message: "Формуємо структурований звіт" });
        await progressQueue;
    }

    if (abortError) {
        abortError.report = report;
        throw abortError;
    }
    return { report };
}


export { KeyedMutex, normalizeConcurrency };
