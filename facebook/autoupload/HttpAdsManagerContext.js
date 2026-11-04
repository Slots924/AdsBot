import { httpActionTransport } from "../api/actionTransport.js";
import { buildMutationBody, parseFacebookJsonChunks } from "../api/browserRequest.js";
import parseResponse from "./graphql/parseResponse.js";
import { actionError } from "./graphql/errors.js";

// HTTP-контекст Ads Manager використовує перевірену сесію без запуску браузера.
export default class HttpAdsManagerContext {
    constructor(client, profileId, { signal } = {}) {
        Object.assign(this, { client, profileId, signal, writeBlocked: false });
        this[httpActionTransport] = this;
    }
    async readRuntime({ surface = "adsManager" } = {}) {
        if (surface !== "adsManager") throw actionError("Потрібен контекст Ads Manager", "FACEBOOK_SURFACE_INVALID");
        const fbData = this.client.getFbData(this.profileId);
        const { session } = this.client.getAdsManagerData(fbData);
        if (!session.fb_dtsg || !session.lsd) throw actionError("Оновіть сесію Ads Manager", "ADS_MANAGER_SESSION_REQUIRED");
        return {
            av: String(fbData.userId), __user: String(fbData.userId), __a: "1",
            fb_dtsg: session.fb_dtsg, lsd: session.lsd,
            jazoest: session.jazoest || `2${[...session.fb_dtsg].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`,
            __rev: session.clientRevision, __spin_r: session.spinR, __spin_b: session.spinB,
            __spin_t: session.spinT, __hsi: session.hsi, __comet_req: session.cometReq,
        };
    }
    async postForm({ body, friendlyName, endpoint = "/api/graphql/" }) {
        if (endpoint !== "/api/graphql/" || !friendlyName) throw actionError("Непідтримуваний запит Ads Manager", "FACEBOOK_ENDPOINT_INVALID");
        const mutation = !friendlyName.endsWith("Query") && friendlyName !== "PaymentsCometGetServerEncryptionKeyMutation";
        if (mutation && this.writeBlocked) throw actionError("Перевірте результат попередньої дії перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true });
        const runtime = await this.readRuntime();
        const form = new URLSearchParams(body);
        if (["av", "__user"].some(key => form.has(key) && form.get(key) !== runtime[key])) throw actionError("Змінився власник сесії", "FACEBOOK_SESSION_MISMATCH");
        let sent = false;
        try {
            this.signal?.throwIfAborted();
            sent = true;
            const response = await this.client.request({ url: "https://adsmanager.facebook.com/api/graphql/",
                method: "post", data: form.toString(), mutation, signal: this.signal, asFetch: true, allowHttpErrors: true,
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": friendlyName,
                    "X-FB-LSD": runtime.lsd, Origin: "https://adsmanager.facebook.com", Referer: "https://adsmanager.facebook.com/adsmanager/manage/campaigns" },
            });
            parseResponse(response, { session: runtime, mutation });
            return { ok: response.status >= 200 && response.status < 300, statusCode: response.status, body: response.data };
        } catch (error) {
            if (sent && mutation && error.code !== "FACEBOOK_GRAPHQL_ERROR") error.outcomeUnknown = true;
            if (error.outcomeUnknown) this.writeBlocked = true;
            this.failure = error;
            await this.client.invalidateSession?.(error);
            throw error;
        }
    }
    async graphql(friendlyName, docId, variables, extraParameters = {}) {
        const runtime = await this.readRuntime();
        const response = await this.postForm({ friendlyName, body: buildMutationBody(runtime, {
            friendlyName, docId, variables, extraParameters: { ...runtime, ...extraParameters },
        }) });
        return parseFacebookJsonChunks(response.body).find(chunk => chunk.data)?.data;
    }
    async readFields(adAccountId, fieldGroups) {
        const id = String(adAccountId ?? "").replace(/^act_/, "");
        if (!/^\d+$/.test(id)) throw actionError("Некоректний ID РК", "INVALID_INPUT");
        const data = {};
        for (const fields of fieldGroups) {
            Object.assign(data, await this.graph(`act_${id}`, { fields }));
        }
        return { success: true, status: "FETCHED", data };
    }
    async graph(path, params = {}, { mutation = false } = {}) {
        if (!/^(?:act_\d+|me)(?:\/[a-z_]+)?$/.test(path)) throw actionError("Непідтримуваний шлях Graph API", "FACEBOOK_ENDPOINT_INVALID");
        if (mutation && this.writeBlocked) throw actionError("Перевірте результат попередньої зміни", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true });
        try {
            const data = await this.client.requestGraph(this.client.getFbData(this.profileId), path, params, { mutation, signal: this.signal });
            if (mutation && !data?.id) throw actionError("Facebook не повернув ID створеного об’єкта", "FACEBOOK_WRITE_NOT_CONFIRMED", { outcomeUnknown: true });
            return data;
        }
        catch (error) {
            if (error.outcomeUnknown) this.writeBlocked = true;
            this.failure = error;
            await this.client.invalidateSession?.(error);
            throw error;
        }
    }
}
