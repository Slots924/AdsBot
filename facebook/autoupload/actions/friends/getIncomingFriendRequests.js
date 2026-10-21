import requestGraphql from "../../graphql/request.js";
import { actionError, actionFailure } from "../../graphql/errors.js";
import { validateFriendSession } from "./common.js";
import { findIncomingViewers, parseIncomingHtml, normalizeIncomingViewers } from "./parseIncomingFriendRequests.js";

export const incomingFriendRequestsQuery = Object.freeze({
    friendlyName: "FriendingCometRootContentQuery",
    // Ідентифікатор із наданого HAR; окремий POST може не підтримувати цей preload query.
    docId: "28351661531162960",
});

export function incomingRequestsFailure(error) {
    const result = actionFailure(error);
    return { ...result, outcome: "INCOMING_REQUESTS_FAILED", outcomeUnknown: false,
        actionRequired: result.actionRequired === "check_friendship_status" ? "refresh_incoming_requests" : result.actionRequired };
}

// Внутрішній варіант для складеної дії, яка вже утримує чергу клієнта.
export async function loadIncomingFriendRequests(fbData, { signal, source = "auto" } = {}) {
    if (!["auto", "graphql", "html"].includes(source)) throw actionError("Невідоме джерело списку заявок", "FACEBOOK_INCOMING_SOURCE_INVALID");
    signal?.throwIfAborted();
    fbData.client.validateFbData(fbData);
    const diagnostics = [];
    if (source !== "html") {
        try {
            const { chunks, httpStatus, traceId, metaRequestId } = await requestGraphql(fbData, incomingFriendRequestsQuery, { scale: 1 }, { signal, mutation: false });
            const result = normalizeIncomingViewers(findIncomingViewers(chunks), fbData.session);
            return { success: true, outcome: "INCOMING_REQUESTS_LOADED", code: null, message: "Вхідні заявки отримано", source: "graphql",
                ...result, httpStatus, traceId, metaRequestId, diagnostics, outcomeUnknown: false, retryable: false };
        } catch (error) {
            if (signal?.aborted || error.sessionStatus === "login_required" || error.sessionStatus === "checkpoint" || source === "graphql") throw error;
            diagnostics.push({ source: "graphql", ...incomingRequestsFailure(error) });
        }
    }
    signal?.throwIfAborted();
    try {
        const response = await fbData.client.request({ url: "https://www.facebook.com/friends", method: "get", signal });
        const result = normalizeIncomingViewers(parseIncomingHtml(response.data), fbData.session);
        return { success: true, outcome: "INCOMING_REQUESTS_LOADED", code: null, message: "Вхідні заявки отримано", source: "html",
            ...result, httpStatus: response.status, diagnostics, outcomeUnknown: false, retryable: false };
    } catch (error) {
        error.incomingDiagnostics = diagnostics;
        throw error;
    }
}

export default async function getIncomingFriendRequests(fbData, options = {}) {
    try {
        validateFriendSession(fbData);
        return await fbData.client.run(() => loadIncomingFriendRequests(fbData, options));
    } catch (error) {
        if (options.signal?.aborted) error = actionError("Читання заявок перервано", "TASK_INTERRUPTED");
        return { ...incomingRequestsFailure(error), totalCount: null, loadedCount: 0, hasNextPage: null, incomplete: true, requests: [], diagnostics: error.incomingDiagnostics ?? [] };
    }
}
