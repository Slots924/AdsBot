import { httpActionTransport } from "../api/actionTransport.js";
import { buildMutationBody, parseFacebookJsonChunks } from "../api/browserRequest.js";
import parseResponse from "./graphql/parseResponse.js";
import { actionError } from "./graphql/errors.js";

const operations = new Set([
    "CometProfileSwitchMutation", "CometProfilePlusAdminPermissionsRootQuery",
    "ProfilePlusMarkReauthedMutation", "ProfilePlusCoreAppAdminInviteMutation",
]);

// Один контекст обслуговує послідовний workflow доступу до однієї фанки.
export default class HttpPageActionContext {
    constructor(client, { signal, identity = null } = {}) {
        this.client = client;
        this.signal = signal;
        this.identity = identity;
        this.failure = null;
        this.writeBlocked = false;
        this[httpActionTransport] = this;
    }

    async refresh({ permissionsPage = false } = {}) {
        this.identity = await this.client.readActorContext({ signal: this.signal, updateSession: true,
            ...(permissionsPage ? { url: "https://www.facebook.com/settings/?tab=profile_access" } : {}),
        });
        if (["__comet_req", "__spin_r", "__spin_b", "__spin_t"].some(key => this.identity.runtime[key] == null)) {
            throw actionError("Недостатньо актуальних параметрів Facebook для операцій із фанкою", "FACEBOOK_SESSION_FIELDS_MISSING");
        }
        return this.identity;
    }

    async readRuntime({ surface = "facebook" } = {}) {
        this.signal?.throwIfAborted();
        if (surface !== "facebook" || !this.identity) throw actionError("Контекст фанки не підготовлений", "FACEBOOK_SESSION_REQUIRED");
        return this.identity.runtime;
    }

    requireActor(id) {
        if (this.identity?.actorId !== String(id)) throw actionError("Actor не відповідає потрібній фанці", "FACEBOOK_SESSION_MISMATCH");
    }

    async graphql({ friendlyName, docId, variables }) {
        const runtime = await this.readRuntime();
        const response = await this.postForm({ friendlyName,
            body: buildMutationBody(runtime, { friendlyName, docId, variables,
                extraParameters: { __spin_r: runtime.__spin_r, __spin_b: runtime.__spin_b, __spin_t: runtime.__spin_t },
            }),
        });
        return parseResponse({ status: response.statusCode, data: response.body }, { session: runtime, mutation: friendlyName.endsWith("Mutation") });
    }

    async postForm({ body, friendlyName, endpoint = "/api/graphql/" }) {
        const mutation = friendlyName?.endsWith("Mutation") === true;
        let sent = false;
        this.failure = null;
        try {
            if (!operations.has(friendlyName) || endpoint !== "/api/graphql/") throw actionError("Непідтримувана операція контексту фанки", "FACEBOOK_ENDPOINT_INVALID");
            if (mutation && this.writeBlocked) throw actionError("Попередня зміна має невизначений результат", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true });
            const runtime = await this.readRuntime();
            const form = new URLSearchParams(body);
            if (["av", "__user"].some(key => form.get(key) !== String(runtime[key]))) throw actionError("Actor запиту змінився", "FACEBOOK_SESSION_MISMATCH");
            if (friendlyName === "CometProfileSwitchMutation") this.client.invalidateActorContext();
            sent = true;
            const response = await this.client.request({ url: "https://www.facebook.com/api/graphql/", method: "post",
                data: form.toString(), mutation, asFetch: true, allowHttpErrors: true, signal: this.signal,
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": friendlyName, "X-FB-LSD": runtime.lsd },
            });
            try {
                if (!(friendlyName === "CometProfileSwitchMutation" && response.status >= 200 && response.status < 300 && !String(response.data ?? "").trim())) {
                    parseResponse(response, { session: runtime, mutation });
                }
            } catch (error) {
                if (mutation && error.code === "FACEBOOK_GRAPHQL_ERROR") {
                    const partial = parseFacebookJsonChunks(response.data).some(chunk => chunk.data
                        && Object.entries(chunk.data).some(([key, value]) => key !== "errors" && value != null));
                    if (partial) error.outcomeUnknown = true;
                }
                throw error;
            }
            return { ok: response.status >= 200 && response.status < 300, statusCode: response.status, body: response.data };
        } catch (error) {
            if (mutation && sent && error.code !== "FACEBOOK_GRAPHQL_ERROR") error.outcomeUnknown = true;
            if (error.outcomeUnknown) this.writeBlocked = true;
            this.failure = error;
            throw error;
        }
    }
}
