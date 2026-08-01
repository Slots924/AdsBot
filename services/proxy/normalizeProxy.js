export default function normalizeProxy(proxyConfig) {

    // Перевіряємо, чи AdsPower взагалі повернув проксі
    if (!proxyConfig) {
        throw new Error("AdsPower не повернув налаштування проксі");
    }

    // Якщо в профілі встановлено роботу без проксі
    if (
        proxyConfig.proxy_soft === "no_proxy" ||
        proxyConfig.proxy_type === "no_proxy"
    ) {
        throw new Error("У профілі не встановлена проксі");
    }

    // Беремо основні дані проксі
    const type = proxyConfig.proxy_type;
    const host = proxyConfig.proxy_host;
    const port = proxyConfig.proxy_port;

    // Без цих трьох полів перевірити проксі неможливо
    if (!type || !host || !port) {
        throw new Error(
            "AdsPower повернув неповні дані проксі"
        );
    }

    // Повертаємо проксі у нашому простому форматі
    return {
        type: type.toLowerCase(),
        host,
        port: String(port),

        // Логін і пароль можуть бути порожніми
        username: proxyConfig.proxy_user || "",
        password: proxyConfig.proxy_password || "",
    };
}