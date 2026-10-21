export const requiredSessionFields = ["fb_dtsg", "jazoest", "sessionID", "FacebookID", "clientRevision"];

// Повертає лише поля сесії; HTML ніколи не потрапляє до журналу.
export default function parseWebSession(html) {
    const source = String(html ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const first = (...patterns) => patterns.map((pattern) => source.match(pattern)?.[1]).find(Boolean) ?? "";
    const fb_dtsg = first(/DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /name="fb_dtsg"\s+value="([^"]+)"/);
    const session = {
        fb_dtsg,
        fb_dtsg_ag: first(/"async_get_token"\s*:\s*"([^"]+)"/),
        lsd: first(/LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, /name="lsd"\s+value="([^"]+)"/),
        jazoest: first(/name="jazoest"\s+value="(\d+)"/, /[?&]jazoest=(\d+)/, /"jazoest"\s*:\s*"?(\d+)/),
        sessionID: first(/"sessionId"\s*:\s*"([^"]+)"/),
        FacebookID: first(/"actorID"\s*:\s*"(\d+)"/, /"USER_ID"\s*:\s*"(\d+)"/),
        clientRevision: first(/"client_revision"\s*:\s*"?(\d+)/),
        hsi: first(/"hsi"\s*:\s*"(\d+)"/),
        spinR: first(/"__spin_r"\s*:\s*"?(\d+)/),
        spinB: first(/"__spin_b"\s*:\s*"([^"]+)"/),
        spinT: first(/"__spin_t"\s*:\s*"?(\d+)/),
    };
    const missing = requiredSessionFields.filter((field) => !session[field]);
    return { session, missing };
}
