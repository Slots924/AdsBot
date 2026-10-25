import { httpActionTransport } from "../api/actionTransport.js";
import parseResponse from "./graphql/parseResponse.js";
import { actionError } from "./graphql/errors.js";

// Контекст дозволяє лише читання списку профілів від поточного actor, зокрема фанки.
export default class HttpProfileReadContext {
    constructor(client, identity, { signal } = {}) {
        this.client = client;
        this.identity = identity;
        this.signal = signal;
        this[httpActionTransport] = this;
    }

    async readRuntime({ surface = "facebook" } = {}) {
        this.signal?.throwIfAborted();
        if (surface !== "facebook") throw actionError("Непідтримуваний контекст Facebook", "FACEBOOK_SURFACE_INVALID");
        return this.identity.runtime;
    }

    async postForm({ body, friendlyName, endpoint = "/api/graphql/" }) {
        try {
            return await this.#postForm({ body, friendlyName, endpoint });
        } catch (error) {
            this.failure = error;
            throw error;
        }
    }

    async #postForm({ body, friendlyName, endpoint }) {
        if (friendlyName !== "CometProfileSwitcherListQuery" || endpoint !== "/api/graphql/") {
            throw actionError("Контекст підтримує лише читання списку профілів", "FACEBOOK_ENDPOINT_INVALID");
        }
        const runtime = await this.readRuntime();
        const form = new URLSearchParams(body);
        if (["av", "__user"].some(key => form.get(key) !== runtime[key])) {
            throw actionError("Actor запиту не відповідає поточному контексту", "FACEBOOK_SESSION_MISMATCH");
        }
        const response = await this.client.request({
            url: "https://www.facebook.com/api/graphql/", method: "post", data: form.toString(),
            signal: this.signal, mutation: false, asFetch: true, allowHttpErrors: true,
            headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": friendlyName, "X-FB-LSD": runtime.lsd },
        });
        parseResponse(response, { session: runtime, mutation: false });
        return { ok: true, statusCode: response.status, body: response.data };
    }
}
