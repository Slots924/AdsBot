import { redactString } from "../../../services/logging/AppLogger.js";

// Повертає лише дозволені діагностичні поля, без payload, HTML та об'єкта сесії.
export function safeGraphText(value, session = {}) {
    let text = redactString(String(value ?? ""));
    for (const key of ["fb_dtsg", "fb_dtsg_ag", "lsd"]) {
        if (session[key]) text = text.split(String(session[key])).join("[REDACTED]");
    }
    return text.replace(/\b(c_user|xs|fr|datr|sb)=([^;\s]+)/gi, "$1=[REDACTED]").slice(0, 1500);
}

export function actionError(message, code, details = {}) {
    return Object.assign(new Error(message), { code, retryable: false, outcomeUnknown: false, safeFacebookError: true, ...details });
}

export function actionFailure(error) {
    const trusted = error?.safeFacebookError === true || Boolean(error?.sessionStatus);
    return {
        success: false,
        outcome: error?.outcomeUnknown ? "OUTCOME_UNKNOWN" : "NOT_CONFIRMED",
        code: trusted ? error.code ?? "FACEBOOK_SESSION_ERROR" : "FACEBOOK_ACTION_FAILED",
        message: trusted ? error.message : "Не вдалося виконати дію Facebook",
        httpStatus: trusted ? error.httpStatus ?? null : null,
        graphCode: trusted ? error.graphCode ?? null : null,
        graphSubcode: trusted ? error.graphSubcode ?? null : null,
        apiErrorCode: trusted ? error.apiErrorCode ?? null : null,
        graphType: trusted ? error.graphType ?? null : null,
        graphUserTitle: trusted ? error.graphUserTitle ?? null : null,
        graphUserMessage: trusted ? error.graphUserMessage ?? null : null,
        traceId: trusted ? error.traceId ?? null : null,
        metaRequestId: trusted ? error.metaRequestId ?? null : null,
        friendshipStatus: trusted ? error.friendshipStatus ?? null : null,
        errors: trusted ? error.errors ?? [] : [],
        isTransient: trusted ? error.isTransient === true : false,
        sessionStatus: trusted ? error.sessionStatus ?? null : null,
        actionRequired: trusted ? error.actionRequired ?? (error.sessionStatus === "login_required" ? "authenticate_account" : error.sessionStatus === "checkpoint" ? "confirm_account" : null) : null,
        outcomeUnknown: error?.outcomeUnknown === true,
        retryable: false,
    };
}
