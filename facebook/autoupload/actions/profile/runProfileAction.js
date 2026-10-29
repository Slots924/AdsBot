import HttpActionContext from "../../HttpActionContext.js";
import { actionError, actionFailure, safeGraphText } from "../../graphql/errors.js";

const counts = ["deletedCount", "hiddenCount", "failedCount", "remainingCount", "publishedCount", "backdatedCount", "requestedCount"];

// Залишає у звіті тільки підсумки, без HTML, сесії, колекцій і сирих GraphQL-даних.
export default async function runProfileAction(fbData, options, execute, message) {
    let context;
    const summary = {};
    try {
        if (typeof fbData?.client?.run !== "function") throw actionError("Спочатку перевірте сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
        return await fbData.client.run(async () => {
            context = options.context ?? new HttpActionContext(fbData, options);
            context.beginAction(fbData);
            context.beforeMutation = options.beforeMutation;
            await context.prepare();
            const result = await execute(context);
            Object.assign(summary, Object.fromEntries(counts.filter(key => Number.isFinite(result[key])).map(key => [key, result[key]])));
            if (result.steps) summary.actionSteps = Object.fromEntries(Object.entries(result.steps).map(([key, step]) => [key, { success: step.success === true, status: step.status, error: step.error ? safeGraphText(step.error, fbData.session) : null }]));
            if (result.items) summary.postResults = result.items.map(item => ({ sequence: item.sequence, storyId: item.storyId, created: item.created, backdated: item.backdated, createStatus: item.createStatus, backdateStatus: item.backdateStatus }));
            if (context.failure) throw context.failure;
            return { success: result.success === true, outcome: result.status, code: result.success ? null : "FACEBOOK_PROFILE_ACTION_INCOMPLETE",
                message: result.success ? message : `${message}: операцію не завершено (${result.status})`, ...summary,
                skipped: result.skipped === true, mutationAttempted: context.writeCount > 0,
                httpStatus: result.httpStatus ?? null, outcomeUnknown: !result.success && context.writeCount > 0,
                graphUserMessage: result.error ? safeGraphText(result.error, fbData.session) : null,
                actionRequired: !result.success && context.writeCount > 0 ? "check_profile_changes" : null, retryable: false };
        });
    } catch (error) {
        const primary = context?.failure ?? error;
        const failure = { ...actionFailure(primary), ...summary, mutationAttempted: context?.writeCount > 0, stage: primary.actionStage ?? null };
        if (failure.actionRequired === "refresh_incoming_requests") failure.actionRequired = "refresh_session";
        if (failure.outcomeUnknown) Object.assign(failure, { outcome: "OUTCOME_UNKNOWN", actionRequired: "check_profile_changes" });
        return failure;
    }
}
