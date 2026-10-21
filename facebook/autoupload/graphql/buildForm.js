import { actionError } from "./errors.js";

export default function buildForm(fbData, { friendlyName, docId, variables }) {
    if (!fbData?.client || !/^\d+$/.test(String(fbData.userId ?? "")) || String(fbData.session?.FacebookID) !== String(fbData.userId)) {
        throw actionError("Дані сесії не відповідають поточному акаунту", "FACEBOOK_SESSION_MISMATCH");
    }
    const session = fbData.session;
    const missing = ["fb_dtsg", "jazoest", "lsd"].filter((key) => !session[key]);
    if (missing.length) throw actionError(`Оновіть сесію: відсутні поля ${missing.join(", ")}`, "FACEBOOK_SESSION_FIELDS_MISSING", { actionRequired: "refresh_session" });
    const form = new URLSearchParams({
        av: String(fbData.userId), __user: String(fbData.userId), __a: "1",
        fb_dtsg: session.fb_dtsg, jazoest: session.jazoest, lsd: session.lsd,
        fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: friendlyName,
        server_timestamps: "true", doc_id: String(docId), variables: JSON.stringify(variables),
    });
    for (const [field, value] of Object.entries({
        __rev: session.clientRevision, __hsi: session.hsi,
        __spin_r: session.spinR, __spin_b: session.spinB, __spin_t: session.spinT,
    })) if (value) form.set(field, String(value));
    return form;
}
