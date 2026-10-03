import detectAccountRecoveryStep from "../detectAccountRecoveryStep.js";

export default async function isReady(page) {
    try {
        const url = new URL(page.url());
        if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) return false;
        return (await detectAccountRecoveryStep(page)).step === "AUTHENTICATED";
    } catch { return false; }
}
