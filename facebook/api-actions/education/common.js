export const graphqlEndpoint = "/api/graphql/";
export const defaultTimeoutMs = 30000;


// Формує стандартний результат для Education API actions.
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
export function validateMutationInput(page, commonPayload) {
    if (!page || typeof page.evaluate !== "function") {
        return "Не передано Puppeteer page";
    }

    if (!commonPayload || typeof commonPayload !== "object") {
        return "Не передано commonPayload";
    }

    const requiredFields = [
        "av",
        "__user",
        "__a",
        "fb_dtsg",
        "jazoest",
        "lsd",
        "__comet_req",
    ];
    const missingField = requiredFields.find(
        (field) => commonPayload[field] === undefined
            || commonPayload[field] === null
    );

    return missingField
        ? `У commonPayload відсутнє поле ${missingField}`
        : null;
}


// Формує body у форматі, який використовують GraphQL-запити Facebook.
export function buildMutationBody(commonPayload, {
    friendlyName,
    docId,
    variables,
    extraParameters = {},
}) {
    const parameters = {
        av: String(commonPayload.av),
        __user: String(commonPayload.__user),
        __a: String(commonPayload.__a),
        fb_dtsg: String(commonPayload.fb_dtsg),
        jazoest: String(commonPayload.jazoest),
        lsd: String(commonPayload.lsd),
        __comet_req: String(commonPayload.__comet_req),
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
    lsd,
    timeout,
    endpoint = graphqlEndpoint,
}) {
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
                        "x-fb-friendly-name": requestFriendlyName,
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
            requestBody: body,
            requestFriendlyName: friendlyName,
            requestLsd: String(lsd),
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
export function parseFacebookJson(rawResponse) {
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
