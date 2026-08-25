const knownTypes = new Set([
    "socks5",
    "http",
    "https",
]);


function invalid(message) {
    return { ok: false, message };
}


export default function parseProxyPaste(value) {
    const text = String(value ?? "").trim();
    if (!text) {
        return invalid("Вставте рядок проксі");
    }

    let refreshUrl = "";
    let body = text;
    const bracket = text.match(/\[(https?:\/\/[^\]]+)\]\s*$/i);
    if (bracket) {
        refreshUrl = bracket[1].trim();
        body = text.slice(0, bracket.index).trim();
    }

    let type = "";
    const protocol = body.match(/^(socks5|http|https):\/\//i);
    if (protocol) {
        type = protocol[1].toLowerCase();
        body = body.slice(protocol[0].length);
    }

    if (type && !knownTypes.has(type)) {
        return invalid(`Тип проксі "${type}" не підтримується`);
    }

    let username = "";
    let password = "";
    const at = body.lastIndexOf("@");
    if (at > 0) {
        const auth = body.slice(0, at);
        body = body.slice(at + 1);
        const separator = auth.indexOf(":");
        if (separator >= 0) {
            username = auth.slice(0, separator);
            password = auth.slice(separator + 1);
        } else {
            username = auth;
        }
    }

    const parts = body.split(":");
    if (parts.length < 2) {
        return invalid("Не вдалося знайти хост і порт");
    }

    const host = String(parts[0] ?? "").trim();
    const port = String(parts[1] ?? "").trim();
    if (!host) {
        return invalid("Не вдалося знайти хост");
    }

    const numericPort = Number(port);
    if (
        !Number.isInteger(numericPort)
        || numericPort < 1
        || numericPort > 65535
    ) {
        return invalid("Порт має бути числом від 1 до 65535");
    }

    if (at < 0 && parts.length >= 3) {
        username = String(parts[2] ?? "");
        password = parts.slice(3).join(":");
    }

    return {
        ok: true,
        type,
        host,
        port,
        username,
        password,
        refreshUrl,
    };
}
