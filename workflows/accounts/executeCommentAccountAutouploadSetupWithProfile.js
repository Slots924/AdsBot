import { setTimeout as delay } from "node:timers/promises";
import checkProfileSession from "../autoupload/checkProfileSession.js";
import prepareSocialContext from "../../facebook/autoupload/workflows/prepareSocialContext.js";
import { prepareNameContext, executeNameChange } from "../../facebook/autoupload/actions/accounts/changeFacebookName.js";
import changeProfilePicture from "../../facebook/autoupload/actions/profile/changeProfilePicture.js";
import changeCoverPhoto from "../../facebook/autoupload/actions/profile/changeCoverPhoto.js";
import clearProfilePosts from "../../facebook/autoupload/actions/profile/clearProfilePosts.js";
import publishProfilePostsWithDates from "../../facebook/autoupload/actions/profile/publishProfilePostsWithDates.js";
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
export default async function executeCommentAccountAutouploadSetupWithProfile(options = {}) {
    const { adsPower, profile, persona, photoSet, profileNameNote = "", signal, logger = console,
        random = Math.random, actionDelaySeconds = 30, skipNameChange = false,
        skipAvatarChange = false, skipCoverChange = false, skipDeletePosts = false, skipPublishPosts = false,
        actions = {} } = options;
    const profileNo = String(profile.profile_no);
    const adsPowerName = buildAdsPowerProfileName(persona);
    const result = { profileNo, persona, adsPowerName, photoFolder: photoSet?.path ?? null,
        renamedPhotoFolder: null, success: false, outcome: "failed", stage: "SESSION", error: null,
        steps: createEmptySteps(), cleanupErrors: [], nameChanged: false, aborted: false };
    for (const key of Object.keys(result.steps)) result.steps[key] = createStep({ skipped: true, reason: "Ще не виконано" });
    result.steps.about = createStep({ skipped: true, reason: "Недоступно для автоаплоаду" });
    let previousAction = false;
    let blocked = null;
    let ready = false;
    let client;
    let fbData;
    let context;
    const waitBeforeAction = async () => {
        signal?.throwIfAborted();
        if (previousAction) {
            const milliseconds = Math.max(0, Number(actionDelaySeconds) + random() * 10 - 5) * 1000;
            await (actions.wait ?? ((ms) => delay(ms, undefined, { signal })))(milliseconds);
        }
        signal?.throwIfAborted();
        // Тривалий сценарій оновлює прострочений контекст до наступного запису, без повторення mutation.
        if (client && !actions.prepareSocialContext) {
            try { client.validateFbData(fbData); }
            catch (error) {
                if (error.code !== "FACEBOOK_SESSION_EXPIRED") throw error;
                await client.checkSession({ signal });
                ({ fbData, context } = await prepareSocialContext(client, profile.profile_id, { signal }));
            }
        }
        previousAction = true;
    };
    const record = (key, value) => {
        const error = value.success ? null : [value.message, value.graphUserMessage].filter(Boolean).join(": ");
        result.steps[key] = createStep({ ok: value.success === true, status: value.outcome,
            detail: value.success ? value.message : null, error, diagnostic: value });
        if (stopsWorkflow(value)) blocked = error || "Подальші дії зупинено";
        return value;
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
                return result;
            }
        }
        const classified = classifyPhotoFiles(photoSet?.files ?? []);
        const usedPaths = new Set();
        const fallbackPool = [...classified.rest];
        for (const [key, skip, candidate, action] of [
            ["avatar", skipAvatarChange, classified.avatarCandidate, actions.changeAvatar ?? changeProfilePicture],
            ["cover", skipCoverChange, classified.coverCandidate, actions.changeCover ?? changeCoverPhoto],
        ]) {
            if (skip || blocked) {
                result.steps[key] = createStep({ skipped: true, reason: blocked || "Дію вимкнено" });
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
            if (attempt.unusedCandidate && !fallbackPool.includes(attempt.unusedCandidate)) fallbackPool.push(attempt.unusedCandidate);
        }
        if (skipDeletePosts || blocked) result.steps.deletePosts = createStep({ skipped: true, reason: blocked || "Дію вимкнено" });
        else {
            result.stage = "DELETE_POSTS";
            await waitBeforeAction();
            record("deletePosts", await (actions.deletePosts ?? clearProfilePosts)(fbData, {}, { signal, context }));
        }
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
                const value = await (actions.publishPosts ?? publishProfilePostsWithDates)(fbData,
                    { posts: [{ mediaPaths: [file], targetDate: dates[index] }] }, { signal, context });
                items.push({ sequence: index + 1, targetDate: dates[index], ...value });
                record(`post${index + 1}`, value);
            }
            result.steps.posts = createStep({ ok: items.length === postFiles.length && items.every(item => item.success),
                detail: `Пости: ${items.filter(item => item.success).length}/${postFiles.length}`,
                error: items.some(item => !item.success) || items.length !== postFiles.length ? "Не всі пости створено та датовано" : null,
                items });
        }
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
    }
    return result;
}
