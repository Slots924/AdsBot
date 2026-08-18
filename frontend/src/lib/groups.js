export function findGroupForGeo(groups, geo) {
    const normalizedGeo = String(geo ?? "").trim().toUpperCase();

    if (!/^[A-Z]{2}$/.test(normalizedGeo) || !Array.isArray(groups)) {
        return null;
    }

    const marker = `[${normalizedGeo}]`.toLocaleLowerCase();

    return groups.find((group) =>
        String(group?.groupName ?? "")
            .toLocaleLowerCase()
            .includes(marker)
    ) ?? null;
}
