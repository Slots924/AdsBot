import { withHttpWorkflow } from "../../services/reports/HttpExchangeTrace.js";
import { setTimeout as delay } from "node:timers/promises";
import checkProfileSession from "../autoupload/checkProfileSession.js";
import prepareSocialContext from "../../facebook/autoupload/workflows/prepareSocialContext.js";
import { prepareNameContext, executeNameChange } from "../../facebook/autoupload/actions/accounts/changeFacebookName.js";
import changeProfilePicture from "../../facebook/autoupload/actions/profile/changeProfilePicture.js";
import changeCoverPhoto from "../../facebook/autoupload/actions/profile/changeCoverPhoto.js";
import clearProfilePosts from "../../facebook/autoupload/actions/profile/clearProfilePosts.js";
import publishProfilePostsWithDates from "../../facebook/autoupload/actions/profile/publishProfilePostsWithDates.js";
import updateBio from "../../facebook/autoupload/actions/profile/updateBio.js";
import updateAbout from "../../facebook/autoupload/actions/profile/updateAbout.js";
import { actionFailure } from "../../facebook/autoupload/graphql/errors.js";
import { classifyPhotoFiles, renamePhotoSet } from "../../services/accounts/photoSets.js";
import createRandomPostDates from "../../services/accounts/randomPostDates.js";
import buildAdsPowerProfileName from "../../services/accounts/buildAdsPowerProfileName.js";
import markProfileGender from "../../services/profile/tags/markProfileGender.js";
import markProfileAsChangeNameError from "../../services/profile/tags/markProfileAsChangeNameError.js";
import ensureWorkerProxyReady from "../../services/proxy/ensureWorkerProxyReady.js";
import finalizeSetupMetadata from "./finalizeSetupMetadata.js";
import { createStep, createEmptySteps, tryProfilePhoto } from "./executeCommentAccountSetupWithProfile.js";

const stopsWorkflow = result => Boolean(result.outcomeUnknown || result.sessionStatus
    || ["FACEBOOK_SESSION_MISMATCH", "FACEBOOK_SOCIAL_CONTEXT_REQUIRED", "FACEBOOK_SESSION_FIELDS_MISSING", "FACEBOOK_SESSION_EXPIRED"].includes(result.code));

// Затримка відбувається перед наступною логічною дією, без очікування після останньої.
async function executeCommentAccountAutouploadSetupWithProfileImpl(options = {}) {
    const { adsPower, profile, persona, photoSet, profileNameNote = "", signal, logger = console,
        random = Math.random, actionDelaySeconds = 30, skipNameChange = false,
        skipAvatarChange = false, skipCoverChange = false, skipDeletePosts = false, skipPublishPosts = false,
        skipFillAbout = false, skipBio = false,
        actions = {} } = options;
    const profileNo = String(profile.profile_no);
    const adsPowerName = buildAdsPowerProfileName(persona);
    const result = { profileNo, persona, adsPowerName, photoFolder: photoSet?.path ?? null,
        renamedPhotoFolder: null, success: false, outcome: "failed", stage: "SESSION", error: null,
        steps: createEmptySteps(), cleanupErrors: [], nameChanged: false, aborted: false };
    for (const key of Object.keys(result.steps)) result.steps[key] = createStep({ skipped: true, reason: "Ще не виконано" });
    const log = message => logger.info?.(message);
    const logStep = (label, step, successText) => {
        if (step.skipped) log(`- ${label}: пропущено (${step.reason || "дію вимкнено"})`);
        else if (step.ok) log(`- ${successText}`);
        else log(`- ${label}: не вдалося — ${step.error || "причину не вказано"}`);
    };
    log(`\n\nАкаунт №${profileNo} — ${adsPowerName}`);
    let previousAction = false;
    let blocked = null;
    let ready = false;
    let client;
    let fbData;
    let context;
    const refreshContext = async () => {
        // Оновлення сесії виконується поза чергою окремої HTTP-дії.
        if (client && !actions.prepareSocialContext) {
            try { client.validateFbData(fbData); }
            catch (error) {
                if (error.code !== "FACEBOOK_SESSION_EXPIRED") throw error;
                await client.checkSession({ signal });
                ({ fbData, context } = await prepareSocialContext(client, profile.profile_id, { signal }));
            }
        }
    };
    const waitBeforeAction = async ({ refresh = true } = {}) => {
        signal?.throwIfAborted();
        if (previousAction) {
            const milliseconds = Math.max(0, Number(actionDelaySeconds) + random() * 10 - 5) * 1000;
            await (actions.wait ?? ((ms) => delay(ms, undefined, { signal })))(milliseconds);
        }
        signal?.throwIfAborted();
        if (refresh) await refreshContext();
        previousAction = true;
    };
    const record = (key, value) => {
        const error = value.success ? null : [value.message, value.graphUserMessage].filter(Boolean).join(": ");
        result.steps[key] = createStep({ ok: value.success === true, status: value.outcome,
            detail: value.success ? value.message : null, error, diagnostic: value });
        const labels = { name: ["Ім’я", "Ім’я змінено"], deletePosts: ["Видалення постів", "Пости очищено"] };
        if (labels[key]) {
            let successText = labels[key][1];
            if (key === "deletePosts" && Number.isFinite(value.deletedCount)) {
                successText = `Видалено постів: ${value.deletedCount}`;
                if (value.hiddenCount) successText += `, приховано системних: ${value.hiddenCount}`;
            }
            logStep(labels[key][0], result.steps[key], successText);
        }
        if (stopsWorkflow(value)) blocked = error || "Подальші дії зупинено";
        return value;
    };
    const attemptAction = async execute => {
        try { return await execute(); }
        catch (error) {
            signal?.throwIfAborted();
            return actionFailure(error);
        }
    };
    const finalizeOutcome = () => {
        if (result.aborted || (!skipNameChange && !result.nameChanged) || (!result.nameChanged && result.error)) {
            result.outcome = "failed";
        } else {
            const warnings = result.error || Object.values(result.steps).some(step => !step.ok && !step.skipped);
            result.outcome = warnings ? "completed_with_error" : "success";
        }
        result.success = result.outcome === "success";
    };
    try {
        signal?.throwIfAborted();
        let workerProxy = options.workerProxy;
        while (workerProxy) {
            const status = await (actions.ensureWorkerProxyReady ?? ensureWorkerProxyReady)(workerProxy, { signal });
            if (status.working) break;
            const decision = await options.onProxyUnavailable?.({ workerId: options.workerId, profileNo, proxy: workerProxy, ...status });
            if (decision?.type === "replace" && decision.proxy) workerProxy = decision.proxy;
            else {
                result.skippedDueToProxy = true;
                result.error = status.error || "Проксі воркера недоступна";
                return result;
            }
        }
        const prepared = await (actions.checkProfileSession ?? checkProfileSession)({ adsPower, profile,
            profileId: profile.profile_id, proxy: workerProxy ?? undefined, signal });
        result.steps.session = createStep({ ok: Boolean(prepared.client), error: prepared.client ? null : prepared.result.message,
            diagnostic: prepared.result.diagnostic ?? null, detail: prepared.result.message });
        if (!prepared.client) { result.error = prepared.result.message; return result; }
        client = prepared.client;
        ({ fbData, context } = await (actions.prepareSocialContext ?? prepareSocialContext)(client, profile.profile_id, { signal }));
        ready = true;
        if (skipNameChange) result.steps.name = createStep({ ok: true, skipped: true, reason: "Зміну імені вимкнено" });
        else {
            result.stage = "CHANGE_NAME";
            try {
                const session = await (actions.prepareNameContext ?? prepareNameContext)(fbData, { signal });
                await waitBeforeAction();
                const name = record("name", await (actions.changeName ?? executeNameChange)(fbData, persona, { signal, session }));
                result.nameChanged = name.success === true;
            } catch (error) {
                signal?.throwIfAborted();
                record("name", actionFailure(error));
            }
            if (!result.nameChanged) {
                result.error = result.steps.name.error;
                try { await (actions.markChangeNameError ?? markProfileAsChangeNameError)(adsPower, profile); }
                catch (error) { result.cleanupErrors.push(error.message); }
            }
        }
        if (skipNameChange) logStep("Ім’я", result.steps.name, "Ім’я змінено");
        const classified = classifyPhotoFiles(photoSet?.files ?? []);
        const usedPaths = new Set();
        const fallbackPool = [...classified.rest];
        for (const [key, skip, candidate, action] of [
            ["avatar", skipAvatarChange, classified.avatarCandidate, actions.changeAvatar ?? changeProfilePicture],
            ["cover", skipCoverChange, classified.coverCandidate, actions.changeCover ?? changeCoverPhoto],
        ]) {
            if (skip || blocked) {
                result.steps[key] = createStep({ skipped: true, reason: blocked || "Дію вимкнено" });
                logStep(key === "avatar" ? "Аватар" : "Обкладинка", result.steps[key], "");
                continue;
            }
            result.stage = key === "avatar" ? "CHANGE_AVATAR" : "CHANGE_COVER";
            const attempt = await tryProfilePhoto({ page: context, candidate, fallbackPool, usedPaths, logger, role: key,
                changeFn: async (_, input) => {
                    await waitBeforeAction();
                    const value = await action(fbData, input, { signal, context });
                    if (stopsWorkflow(value)) blocked = value.message;
                    return { ...value, status: value.outcome, diagnostic: value,
                        error: { message: [value.message, value.graphUserMessage].filter(Boolean).join(": ") } };
                } });
            result.steps[key] = attempt.step;
            logStep(key === "avatar" ? "Аватар" : "Обкладинка", attempt.step,
                key === "avatar" ? "Аватар змінено" : "Обкладинку змінено");
            if (attempt.unusedCandidate && !fallbackPool.includes(attempt.unusedCandidate)) fallbackPool.push(attempt.unusedCandidate);
        }
        if (skipDeletePosts || blocked) result.steps.deletePosts = createStep({ skipped: true, reason: blocked || "Дію вимкнено" });
        else {
            result.stage = "DELETE_POSTS";
            await waitBeforeAction();
            record("deletePosts", await attemptAction(() => (actions.deletePosts ?? clearProfilePosts)(fbData, {}, { signal, context })));
        }
        if (result.steps.deletePosts.skipped) logStep("Видалення постів", result.steps.deletePosts, "");
        const postFiles = classified.all.filter(file => !usedPaths.has(file));
        if (skipPublishPosts || blocked || !postFiles.length) result.steps.posts = createStep({ skipped: true, reason: blocked || (skipPublishPosts ? "Дію вимкнено" : "Немає фото для постів") });
        else {
            result.stage = "PUBLISH_POSTS";
            const dates = createRandomPostDates(postFiles.length, { random });
            const items = [];
            for (const [index, file] of postFiles.entries()) {
                if (blocked) {
                    result.steps[`post${index + 1}`] = createStep({ skipped: true, reason: blocked });
                    continue;
                }
                await waitBeforeAction();
                // Створення та датування одного поста виконуються разом, без затримки між ними.
                const value = await attemptAction(() => (actions.publishPosts ?? publishProfilePostsWithDates)(fbData,
                    { posts: [{ mediaPaths: [file], targetDate: dates[index] }] }, { signal, context }));
                items.push({ sequence: index + 1, targetDate: dates[index], ...value });
                record(`post${index + 1}`, value);
            }
            result.steps.posts = createStep({ ok: items.length === postFiles.length && items.every(item => item.success),
                detail: `Пости: ${items.filter(item => item.success).length}/${postFiles.length}`,
                error: items.some(item => !item.success) || items.length !== postFiles.length ? "Не всі пости створено та датовано" : null,
                items });
        }
        if (result.steps.posts.skipped) logStep("Публікація постів", result.steps.posts, "");
        else {
            const items = result.steps.posts.items;
            log(`- Опубліковано постів: ${items.filter(item => item.success).length}/${postFiles.length}`);
            for (const item of items.filter(item => !item.success)) {
                log(`  Пост №${item.sequence}: не вдалося — ${[item.message, item.graphUserMessage].filter(Boolean).join(": ") || "причину не вказано"}`);
            }
        }
        if (skipFillAbout || blocked) {
            result.steps.about = createStep({ skipped: true, reason: blocked || "About пропущено" });
        } else {
            const fields = {};
            for (const [key, input, enabled, action] of [
                ["bio", { value: "" }, !skipBio, actions.updateBio ?? updateBio],
                ["work", { work: persona.work }, Boolean(persona.work?.company && persona.work?.position), actions.updateAbout ?? updateAbout],
                ["education", { education: persona.education }, Boolean(persona.education), actions.updateAbout ?? updateAbout],
            ]) {
                if (!enabled || blocked) {
                    fields[key] = { success: !blocked, skipped: true, status: "SKIPPED", error: blocked, reason: blocked || "Поле пропущено" };
                    continue;
                }
                result.stage = `UPDATE_${key.toUpperCase()}`;
                const value = await attemptAction(async () => {
                    await refreshContext();
                    return action(fbData, input, {
                        signal, context, skipIfEmpty: true,
                        beforeMutation: () => waitBeforeAction({ refresh: false }),
                    });
                });
                const error = value.success ? null : [value.message, value.graphUserMessage].filter(Boolean).join(": ");
                fields[key] = { success: value.success === true, skipped: value.skipped === true,
                    status: value.outcome, error, diagnostic: value };
                if (stopsWorkflow(value)) blocked = error || "Подальші дії зупинено";
            }
            for (const [key, label, successText] of [
                ["bio", "Біо", "Біо очищено"], ["work", "Робота", "Роботу змінено"],
                ["education", "Освіта", "Освіту змінено"],
            ]) {
                const field = fields[key];
                const alreadyEmpty = key === "bio" && field.success && field.status === "ALREADY_EMPTY";
                const fallback = field.diagnostic?.actionSteps?.[key]?.fallback;
                logStep(label, { ...field, ok: field.success, skipped: field.skipped && !alreadyEmpty },
                    alreadyEmpty ? "Біо вже порожнє" : `${successText}${fallback ? " (запасним способом)" : ""}`);
            }
            const ok = Object.values(fields).every(field => field.success);
            result.steps.about = createStep({ ok, status: ok ? "COMPLETED" : "PARTIAL", fields,
                error: Object.entries(fields).filter(([, field]) => !field.success)
                    .map(([key, field]) => `${key}: ${field.error || field.status}`).join("; ") || null,
                detail: "Біо, робота та освіта" });
        }
        if (result.steps.about.skipped) logStep("Біо, робота та освіта", result.steps.about, "");
    } catch (error) {
        result.aborted = signal?.aborted || error.name === "AbortError";
        const failure = actionFailure(error);
        result.error = result.aborted ? "Оформлення перервано" : failure.message;
        result.steps.failure = createStep({ error: result.error, diagnostic: failure });
    } finally {
        for (const step of Object.values(result.steps)) {
            if (step.skipped && step.reason === "Ще не виконано") step.reason = blocked || result.error || "Попередній крок не завершено";
        }
        if (ready) await finalizeSetupMetadata({ result, profile, persona, photoSet, profileNo, adsPowerName, profileNameNote,
            skipNameChange, signal, adsPower, createStep, finalizeOutcome,
            updateName: actions.updateProfileName ?? ((id, name) => adsPower.updateProfileName(id, name)),
            markGender: actions.markGender ?? markProfileGender, renameFolder: actions.renamePhotoSet ?? renamePhotoSet });
        else finalizeOutcome();
        if (result.error) log(`- Помилка: ${result.error}`);
        for (const [key, label] of [["adsPowerRename", "Назва профілю AdsPower"], ["genderTag", "Тег статі"],
            ["photoFolderRename", "Папка фото"], ["adsPowerNote", "Примітка профілю"]]) {
            const step = result.steps[key];
            if (step && !step.ok && !step.skipped) logStep(label, step, "");
        }
        for (const error of result.cleanupErrors) log(`- Додаткова помилка: ${error}`);
        const outcome = { success: "успіх", completed_with_error: "успіх з попередженнями", failed: "невдача" }[result.outcome];
        log(`Акаунт №${profileNo} завершено: ${outcome}`);
    }
    return result;
}

export default function executeCommentAccountAutouploadSetupWithProfile(...args) {
    return withHttpWorkflow("executeCommentAccountAutouploadSetupWithProfile", () => executeCommentAccountAutouploadSetupWithProfileImpl(...args), {
        metadata: { profileId: args[0]?.profile?.profile_id, profileNo: args[0]?.profile?.profile_no },
    });
}
