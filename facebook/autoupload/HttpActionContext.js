import { httpActionTransport } from "../api/actionTransport.js";
import parseWebSession from "../session/parseWebSession.js";
import parseResponse from "./graphql/parseResponse.js";
import { actionError } from "./graphql/errors.js";

// Контекст обслуговує окрему дію або послідовний workflow одного соціального профілю.
export default class HttpActionContext {
    #runtime;
    #blocked;
    constructor(fbData, { signal, session = null } = {}) {
        this.fbData = fbData;
        this.signal = signal;
        this.writeCount = 0;
        this.failure = null;
        this[httpActionTransport] = this;
        if (session) this.#runtime = this.#fromSession(session);
    }
    #fromSession(session) {
        if (session.FacebookID !== String(this.fbData.userId)) throw actionError("Контекст належить іншому профілю", "FACEBOOK_SESSION_MISMATCH");
        const runtime = {
            av: String(this.fbData.userId), __user: String(this.fbData.userId), __a: "1",
            fb_dtsg: session.fb_dtsg, lsd: session.lsd,
            jazoest: session.jazoest || `2${[...String(session.fb_dtsg ?? "")].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`,
            __rev: session.clientRevision, __spin_r: session.spinR, __spin_b: session.spinB,
            __spin_t: session.spinT, __hsi: session.hsi, __comet_req: session.cometReq,
        };
        if (["fb_dtsg", "lsd", "__rev", "__spin_r", "__spin_b", "__spin_t", "__comet_req"].some(key => !runtime[key])) {
            throw actionError("Недостатньо параметрів HTTP-сесії", "FACEBOOK_SESSION_FIELDS_MISSING");
        }
        return runtime;
    }
    beginAction(fbData) {
        this.#check();
        if (fbData.client !== this.fbData.client || fbData.session !== this.fbData.session) {
            throw actionError("Контекст сесії змінився", "FACEBOOK_SESSION_MISMATCH");
        }
        this.failure = null;
        this.writeCount = 0;
        this.beforeMutation = null;
    }
    #check() {
        this.signal?.throwIfAborted();
        if (this.#blocked) throw this.#blocked;
        this.fbData.client.validateFbData(this.fbData);
    }
    async prepare({ surface = "facebook" } = {}) {
        this.#check();
        if (surface !== "facebook") throw actionError("Ця дія підтримує лише соціальний Facebook-профіль", "FACEBOOK_SURFACE_INVALID");
        if (!this.#runtime) {
            const response = await this.fbData.client.request({ url: `https://www.facebook.com/profile.php?id=${this.fbData.userId}`, signal: this.signal, mutation: false });
            const { session } = parseWebSession(response.data);
            if (session.FacebookID !== String(this.fbData.userId)) throw actionError("Сторінка належить іншому Facebook-профілю", "FACEBOOK_SESSION_MISMATCH");
            if (!session.fb_dtsg || !session.lsd) throw actionError("Не вдалося прочитати актуальні токени профілю", "FACEBOOK_SESSION_FIELDS_MISSING", { actionRequired: "refresh_session" });
            const saved = this.fbData.session;
            this.#runtime = this.#fromSession({ ...saved,
                ...Object.fromEntries(Object.entries(session).filter(([, value]) => value != null && value !== "")),
            });
        }
        return this.#runtime;
    }
    async readRuntime({ surface = "facebook" } = {}) {
        this.#check();
        if (surface !== "facebook" || !this.#runtime) throw actionError("Контекст HTTP-дії не підготовлений", "FACEBOOK_SESSION_REQUIRED");
        return this.#runtime;
    }
    #remember(error, mutation, sent) {
        if (mutation && sent && error.code !== "FACEBOOK_GRAPHQL_ERROR") error.outcomeUnknown = true;
        if (!this.failure || error.outcomeUnknown || error.sessionStatus) this.failure = error;
        if (error.outcomeUnknown || error.sessionStatus) this.#blocked = error;
        return error;
    }
    async postForm({ body, friendlyName, endpoint = "/api/graphql/" }) {
        let sent = false;
        const graphql = endpoint === "/api/graphql/";
        const mutation = graphql && (/Mutation/.test(friendlyName ?? "") || !/Query$/.test(friendlyName ?? ""));
        try {
            this.#check();
            const runtime = await this.readRuntime();
            const form = new URLSearchParams(body);
            if (["av", "__user"].some(key => form.has(key) && form.get(key) !== runtime[key])) throw actionError("Дія намагається змінити інший профіль", "FACEBOOK_SESSION_MISMATCH");
            for (const key of ["fb_dtsg", "lsd", "jazoest", "__rev", "__spin_r", "__spin_b", "__spin_t", "__comet_req"]) {
                if (form.has(key) && runtime[key] != null) form.set(key, runtime[key]);
            }
            const url = new URL(endpoint, "https://www.facebook.com");
            if (url.origin !== "https://www.facebook.com" || !["/api/graphql/", "/ajax/bulk-route-definitions/"].includes(url.pathname)) throw actionError("Непідтримувана адреса екшена", "FACEBOOK_ENDPOINT_INVALID");
            if (mutation && this.writeCount === 0) await this.beforeMutation?.();
            this.signal?.throwIfAborted();
            sent = true;
            if (mutation) this.writeCount += 1;
            const response = await this.fbData.client.request({ url: url.href, method: "post", data: form.toString(), signal: this.signal, mutation, allowHttpErrors: true,
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-LSD": runtime.lsd, ...(friendlyName ? { "X-FB-Friendly-Name": friendlyName } : {}) },
            });
            const session = { ...this.fbData.session, fb_dtsg: runtime.fb_dtsg, lsd: runtime.lsd, jazoest: runtime.jazoest };
            if (graphql) {
                try {
                    const parsed = parseResponse(response, { session, mutation });
                    if (mutation && !parsed.chunks.some(chunk => chunk.data && Object.entries(chunk.data).some(([key, value]) => key !== "errors" && value != null))) {
                        throw actionError("Facebook не повернув підтвердження зміни профілю", "FACEBOOK_PROFILE_WRITE_NOT_CONFIRMED", { outcomeUnknown: true, actionRequired: "check_profile_changes" });
                    }
                }
                catch (error) { if (mutation && error.code !== "FACEBOOK_GRAPHQL_ERROR") error.outcomeUnknown = true; throw error; }
            } else if (response.status < 200 || response.status >= 300) throw actionError(`Facebook повернув HTTP ${response.status}`, "FACEBOOK_HTTP_ERROR", { httpStatus: response.status });
            return { ok: response.status >= 200 && response.status < 300, statusCode: response.status, body: response.data };
        } catch (error) {
            error.actionStage ??= friendlyName ?? "ABOUT_TOKENS";
            throw this.#remember(error, mutation, sent);
        }
    }
    async uploadPhoto({ endpoint, image, profileId, queryParameters = {}, formParameters = {}, fileFieldName = "file" }) {
        let sent = false;
        try {
            this.#check();
            const runtime = await this.readRuntime();
            if (String(profileId) !== runtime.av) throw actionError("Зображення належить іншому профілю", "FACEBOOK_SESSION_MISMATCH");
            const url = new URL(endpoint, "https://www.facebook.com");
            const allowed = ["https://www.facebook.com/profile/picture/upload/", "https://www.facebook.com/profile/cover/comet_upload/", "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload"];
            if (!allowed.includes(`${url.origin}${url.pathname}`)) throw actionError("Непідтримувана адреса завантаження", "FACEBOOK_ENDPOINT_INVALID");
            for (const [key, value] of Object.entries({ ...runtime, profile_id: profileId, ...queryParameters })) if (value != null) url.searchParams.set(key, String(value));
            const form = new FormData();
            for (const [key, value] of Object.entries({ profile_id: profileId, av: profileId, ...formParameters })) if (value != null) form.append(key, String(value));
            form.append(fileFieldName, new Blob([image.buffer], { type: image.contentType }), image.filename);
            this.signal?.throwIfAborted();
            sent = true;
            this.writeCount += 1;
            const response = await this.fbData.client.request({ url: url.href, method: "post", data: form, signal: this.signal, mutation: true, allowHttpErrors: true });
            parseResponse(response, { session: { ...this.fbData.session, fb_dtsg: runtime.fb_dtsg, lsd: runtime.lsd }, mutation: true });
            return { ok: response.status >= 200 && response.status < 300, statusCode: response.status, body: response.data };
        } catch (error) {
            error.actionStage ??= "PHOTO_UPLOAD";
            throw this.#remember(error, true, sent);
        }
    }
}
