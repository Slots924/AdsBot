export const HUMAN_CONFIRMATION_REQUIRED = "human_confirmation_required";
export const HUMAN_CONFIRMATION_CODE = "FACEBOOK_HUMAN_CONFIRMATION_REQUIRED";

export function isSessionUnavailable(status) {
    return ["login_required", "checkpoint", HUMAN_CONFIRMATION_REQUIRED].includes(status);
}

// Перевіряємо шлях адреси, а не її згадку в параметрах чи HTML.
export function isHumanConfirmationUrl(value, base) {
    try {
        const url = new URL(value, base);
        return url.protocol === "https:"
            && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))
            && /^\/checkpoint\/1501092823525282\/?$/.test(url.pathname);
    } catch { return false; }
}
