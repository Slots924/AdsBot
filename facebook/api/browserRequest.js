import { getFacebookSurface, readFacebookRuntime } from "./runtime.js";
import { getHttpActionTransport, isFacebookApiContext } from "./actionTransport.js";

export const graphqlEndpoint = "/api/graphql/";
export const defaultTimeoutMs = 30000;


// Формує стандартний результат для Facebook API actions.
export function createResult(success, status, data = null, extra = {}) {
    return {
        success,
        status,
        data,
        ...extra,
    };
}


// Нормалізує timeout, щоб action завжди мав коректне обмеження часу.
export function normalizeTimeout(timeout) {
    return Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;
}


// Перевіряє Page та мінімальний набір спільних Facebook параметрів.
export function validateMutationInput(page, runtimeContext, { requireAv = true } = {}) {
    if (!isFacebookApiContext(page)) {
        return "Не передано Puppeteer page";
    }

    if (!runtimeContext || typeof runtimeContext !== "object") {
        return "Не передано runtimeContext";
    }

    if (runtimeContext.runtimeError) return runtimeContext.runtimeError;

    const requiredFields = [
        "__user",
        "__a",
        "fb_dtsg",
        "jazoest",
        "lsd",
        "__comet_req",
    ];
    if (requireAv) requiredFields.unshift("av");
    const missingField = requiredFields.find(
        (field) => runtimeContext[field] === undefined
            || runtimeContext[field] === null
    );

    return missingField
        ? `У runtimeContext відсутнє поле ${missingField}`
        : null;
}


// Формує body у форматі, який використовують GraphQL-запити Facebook.
export function buildMutationBody(runtimeContext, {
    friendlyName,
    docId,
    variables,
    extraParameters = {},
}) {
    const actorValue = String(runtimeContext.av ?? "").trim();
    const parameters = {
        ...(actorValue ? { av: actorValue } : {}),
        __user: String(runtimeContext.__user),
        __a: String(runtimeContext.__a),
        fb_dtsg: String(runtimeContext.fb_dtsg),
        jazoest: String(runtimeContext.jazoest),
        lsd: String(runtimeContext.lsd),
        __comet_req: String(runtimeContext.__comet_req),
        fb_api_caller_class: "RelayModern",
        server_timestamps: "true",
        fb_api_req_friendly_name: friendlyName,
        doc_id: docId,
        variables: JSON.stringify(variables),
        ...Object.fromEntries(
            Object.entries(extraParameters).filter(
                ([, value]) => value !== undefined && value !== null
            ).map(([key, value]) => [key, String(value)])
        ),
    };

    return new URLSearchParams(parameters).toString();
}


// Виконує POST всередині Facebook-сторінки, використовуючи її сесію та cookies.
export async function postFacebookForm(page, {
    body,
    friendlyName,
    timeout,
    endpoint = graphqlEndpoint,
}) {
    const transport = getHttpActionTransport(page);
    if (transport) return transport.postForm({ body, friendlyName, timeout, endpoint });
    const surface = getFacebookSurface(page);
    if (!surface) return { requestError: "RUNTIME_UNAVAILABLE" };
    const current = await readFacebookRuntime(page, { surface, timeout });
    if (current.runtimeError) return { requestError: "RUNTIME_UNAVAILABLE" };
    const parameters = new URLSearchParams(body);
    // Після вкладених запитів або upload токени могли оновитися, а actor має залишитися тим самим.
    if (["av", "__user"].some((key) => parameters.has(key) && parameters.get(key) !== String(current[key]))) {
        return { requestError: "FACEBOOK_ACTOR_CHANGED" };
    }
    for (const key of ["fb_dtsg", "lsd", "jazoest", "__rev", "__spin_r", "__spin_b", "__spin_t", "__comet_req"]) {
        if (parameters.has(key) && current[key] !== undefined) parameters.set(key, String(current[key]));
    }
    return page.evaluate(
        async ({ requestBody, requestFriendlyName, requestLsd, timeoutMs, requestEndpoint }) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(requestEndpoint, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        ...(requestFriendlyName ? { "x-fb-friendly-name": requestFriendlyName } : {}),
                        "x-fb-lsd": requestLsd,
                    },
                    body: requestBody,
                    signal: controller.signal,
                });

                return {
                    ok: response.ok,
                    statusCode: response.status,
                    body: await response.text(),
                };
            } catch (error) {
                return {
                    requestError: error?.name === "AbortError"
                        ? "TIMEOUT"
                        : String(error?.message ?? error),
                };
            } finally {
                clearTimeout(timeoutId);
            }
        },
        {
            requestBody: parameters.toString(),
            requestFriendlyName: friendlyName,
            requestLsd: String(current.lsd),
            timeoutMs: timeout,
            requestEndpoint: endpoint,
        }
    );
}


// Зчитує один JSON-об'єкт або масив із позиції в тексті response.
function readJsonValue(source, startIndex) {
    const firstCharacter = source[startIndex];
    if (firstCharacter !== "{" && firstCharacter !== "[") {
        throw new SyntaxError("Facebook response містить неочікуваний JSON-фрагмент");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
        const character = source[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === "\"") {
                inString = false;
            }
            continue;
        }

        if (character === "\"") {
            inString = true;
        } else if (character === "{" || character === "[") {
            depth += 1;
        } else if (character === "}" || character === "]") {
            depth -= 1;
            if (depth === 0) {
                return {
                    text: source.slice(startIndex, index + 1),
                    nextIndex: index + 1,
                };
            }
        }
    }

    throw new SyntaxError("Facebook response містить незавершений JSON-фрагмент");
}


// Прибирає AJAX-префікс і підтримує кілька JSON-блоків у одному response.
export function parseFacebookJsonChunks(rawResponse) {
    const source = String(rawResponse ?? "")
        .replace(/^for\s*\(\s*;;\s*\);\s*/, "");
    const values = [];
    let cursor = 0;

    while (cursor < source.length) {
        while (/\s/.test(source[cursor] ?? "")) cursor += 1;
        if (cursor >= source.length) break;

        const fragment = readJsonValue(source, cursor);
        values.push(JSON.parse(fragment.text));
        cursor = fragment.nextIndex;
    }

    if (values.length === 0) {
        throw new SyntaxError("Facebook response не містить JSON-даних");
    }
    return values;
}


export function parseFacebookJson(rawResponse) {
    const values = parseFacebookJsonChunks(rawResponse);

    if (values.length === 1) return values[0];

    // Для About query пріоритет має блок із даними поточного користувача.
    const primary = values.find((value) => value?.data?.user)
        ?? values.find((value) => value?.data)
        ?? values[0];
    const errors = values.flatMap((value) => Array.isArray(value?.errors)
        ? value.errors
        : []);

    return errors.length ? { ...primary, errors } : primary;
}


// Перевіряє, чи повернув Facebook GraphQL-помилки.
export function hasGraphqlErrors(data) {
    return Array.isArray(data?.errors) && data.errors.length > 0;
}
