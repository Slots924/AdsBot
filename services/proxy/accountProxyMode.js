export function getAccountProxyMode(account = {}) {
    return account.proxyMode ?? (account.proxyId ? "bound" : "auto");
}

export function normalizeAccountProxySettings(input, { defaultMode = "profile" } = {}) {
    const proxyMode = input.proxyMode ?? (input.proxyId ? "bound" : defaultMode);
    if (!["profile", "auto", "bound"].includes(proxyMode)) {
        throw new Error("Невідомий режим проксі клієнта");
    }
    const proxyId = proxyMode === "bound" ? String(input.proxyId ?? "").trim() : "";
    if (proxyMode === "bound" && !proxyId) throw new Error("Оберіть проксі для прив’язки");
    return { proxyMode, proxyId };
}
