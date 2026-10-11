import checkProxy from "./checkProxy.js";
import toAdsPowerProxyConfig from "./toAdsPowerProxyConfig.js";
import { getAccountProxyMode } from "./accountProxyMode.js";
import isProfileOpen from "../profile/isProfileOpen.js";

export default async function prepareAccountProfileProxy(account, {
    adsPower, proxyManager, checkProxyFn = checkProxy, signal,
}) {
    const mode = getAccountProxyMode(account);
    if (mode === "profile") return;
    const assertActive = () => {
        if (signal?.aborted) throw Object.assign(new Error("Вибір проксі скасовано"), { name: "AbortError" });
    };
    assertActive();
    const candidates = mode === "bound"
        ? [await proxyManager.getById(account.proxyId)]
        : (await proxyManager.list()).filter((proxy) => proxy.type !== "no_proxy" && proxy.isPublic !== false);
    const profile = await adsPower.getProfileByNo(account.adsPowerProfileNo);
    if (await isProfileOpen(adsPower, profile)) {
        throw new Error("Закрийте AdsPower-профіль перед застосуванням проксі клієнта");
    }
    for (const candidate of candidates) {
        assertActive();
        if (candidate.type === "no_proxy") continue;
        const proxy = await proxyManager.getById(candidate.id);
        let status;
        try { status = await checkProxyFn(proxy, { signal }); }
        catch (error) {
            if (error.name === "AbortError") throw error;
            continue;
        }
        assertActive();
        if (!status?.working) continue;
        await adsPower.updateProfileProxy(profile.profile_id, toAdsPowerProxyConfig(proxy));
        return;
    }
    throw Object.assign(new Error(mode === "bound" ? "Прив’язана проксі не працює" : "Немає доступної робочої проксі"), {
        code: "PROXY_POOL_EXHAUSTED",
    });
}
