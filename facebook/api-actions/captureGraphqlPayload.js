// URL GraphQL endpoint Facebook, запит до якого потрібно перехопити.
const facebookGraphqlUrl = "https://www.facebook.com/api/graphql/";

// Максимальний час очікування запиту, якщо інше значення не передали під час виклику.
const defaultTimeoutMs = 30000;


// Стандартизовані статуси, які action може повернути workflow.
export const captureGraphqlPayloadStatuses = Object.freeze({
    PAYLOAD_CAPTURED: "PAYLOAD_CAPTURED",
    TIMEOUT: "TIMEOUT",
    NAVIGATION_FAILED: "NAVIGATION_FAILED",
    PAYLOAD_EMPTY: "PAYLOAD_EMPTY",
    ERROR: "ERROR",
});


// Формує єдиний формат результату для успішного та невдалого завершення action.
function createResult(success, status, data = null, extra = {}) {
    return {
        success,
        status,
        data,
        ...extra,
    };
}


// Перетворює form-urlencoded payload Facebook у звичайний JavaScript-об'єкт.
function parsePayload(rawPayload) {
    return Object.fromEntries(new URLSearchParams(rawPayload));
}


// Відкриває особисту сторінку Facebook і повертає payload першого GraphQL-запиту.
export default async function captureGraphqlPayload(
    page,
    {
        profileUrl = "https://www.facebook.com/me",
        graphqlUrl = facebookGraphqlUrl,
        friendlyName = null,
        timeout = defaultTimeoutMs,
        signal,
    } = {}
) {
    if (!page || typeof page.waitForRequest !== "function") {
        return createResult(
            false,
            captureGraphqlPayloadStatuses.ERROR,
            null,
            { error: "Не передано Puppeteer page" }
        );
    }

    const normalizedTimeout = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;

    if (signal?.aborted) {
        return createResult(
            false,
            captureGraphqlPayloadStatuses.ERROR,
            null,
            { error: "Дію скасовано до початку" }
        );
    }

    let request;
    let navigationResult;

    try {
        // Починаємо слухати мережу до переходу на сторінку,
        // щоб не пропустити ранній GraphQL-запит.
        const requestPromise = page.waitForRequest(
            (candidate) => {
                if (
                    candidate.method() !== "POST"
                    || !candidate.url().startsWith(graphqlUrl)
                ) {
                    return false;
                }
                if (!friendlyName) return true;

                return new URLSearchParams(candidate.postData?.() ?? "")
                    .get("fb_api_req_friendly_name") === friendlyName;
            },
            { timeout: normalizedTimeout }
        );

        // Простий перехід на сторінку без додаткової логіки.
        const navigationPromise = page.goto(profileUrl, {
            waitUntil: "domcontentloaded",
            timeout: normalizedTimeout,
        });

        // Чекаємо і на GraphQL-запит, і на завершення навігації.
        // Помилка навігації зберігається в результаті, щоб не загубити
        // payload, якщо сам запит уже встиг бути перехоплений.
        [request, navigationResult] = await Promise.all([
            requestPromise,
            navigationPromise.then(
                () => ({ success: true }),
                (error) => ({ success: false, error })
            ),
        ]);
    } catch (error) {
        const isTimeout = /timeout/i.test(String(error?.message ?? error));
        const status = isTimeout
            ? captureGraphqlPayloadStatuses.TIMEOUT
            : captureGraphqlPayloadStatuses.NAVIGATION_FAILED;

        return createResult(false, status, null, {
            profileUrl,
            graphqlUrl,
            error: String(error?.message ?? error),
        });
    }

    // postData() повертає тіло HTTP-запиту у початковому вигляді.
    const rawPayload = request.postData?.() ?? null;

    if (!rawPayload) {
        return createResult(
            false,
            captureGraphqlPayloadStatuses.PAYLOAD_EMPTY,
            null,
            {
                profileUrl,
                graphqlUrl: request.url(),
                method: request.method(),
                navigationSuccess: navigationResult?.success === true,
                navigationError: navigationResult?.error?.message ?? null,
            }
        );
    }

    // Повертаємо весь payload як object, не відкидаючи жодного поля.
    const payload = parsePayload(rawPayload);

    return createResult(true, captureGraphqlPayloadStatuses.PAYLOAD_CAPTURED, payload, {
        profileUrl,
        navigationSuccess: navigationResult?.success === true,
        navigationError: navigationResult?.error?.message ?? null,
    });
}
