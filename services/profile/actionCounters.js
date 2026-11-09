// Єдиний формат лічильників дозволяє додавати нові типи успішних дій.
export function readActionCounters(name) {
    const counters = {};
    for (const match of String(name).matchAll(/\b(AU_[A-Z][A-Z0-9_]*)=(\d+)\b/g)) {
        const value = Number(match[2]);
        if (!Number.isSafeInteger(value)) throw new Error("Некоректний лічильник у назві профілю");
        counters[match[1]] = Math.max(counters[match[1]] ?? 0, value);
    }
    return counters;
}

export function formatActionCounters(name, counters) {
    const base = String(name).replace(/\[\s*(?:AU_[A-Z][A-Z0-9_]*=\d+\s*)+\]/g, "")
        .replace(/\bAU_[A-Z][A-Z0-9_]*=\d+\b/g, "").replace(/\s+/g, " ").trim();
    const suffix = Object.entries(counters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(" ");
    const result = `${base}${base ? " " : ""}[${suffix}]`;
    if (result.length > 100) throw new Error("Лічильники не вміщаються у 100 символів назви AdsPower");
    return result;
}

export async function incrementActionCounter({ adsPower, store, profileId, key, eventId, syncLocalName = true }) {
    let profile;
    let readFailed = false;
    try { profile = await adsPower.getProfileById(profileId); }
    catch {
        // Навіть без AdsPower підтверджений ID має один раз збільшити локальний лічильник.
        profile = (await store.snapshot()).profiles.find(item => item.profileId === profileId);
        readFailed = true;
    }
    const remote = readActionCounters(profile?.name ?? "");
    const counters = await store.confirmActionCounter(profileId, key, eventId, remote);
    if (readFailed) throw new Error("AdsPower недоступний; збільшення лічильника збережено локально");
    const name = formatActionCounters(profile.name ?? "", counters);
    if (name !== profile.name) await adsPower.updateProfileName(profileId, name);
    if (syncLocalName) await store.renameProfile(profileId, name);
    return { key, value: counters[key], synced: true };
}
