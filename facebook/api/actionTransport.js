// Явний транспорт дозволяє перевикористовувати API-екшени без емуляції Puppeteer.
export const httpActionTransport = Symbol("facebookHttpActionTransport");

export function getHttpActionTransport(context) {
    return context?.[httpActionTransport] ?? null;
}

export function isFacebookApiContext(context) {
    return typeof context?.evaluate === "function" || Boolean(getHttpActionTransport(context));
}
