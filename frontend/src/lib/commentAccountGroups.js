export function sortGroups(groups, favoriteIds = []) {
    const favorites = new Set(
        (Array.isArray(favoriteIds) ? favoriteIds : []).map(String)
    );
    return [...groups].sort((left, right) => {
        const leftFavorite = favorites.has(String(left.groupId));
        const rightFavorite = favorites.has(String(right.groupId));
        if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
        return String(left.groupName ?? "").localeCompare(
            String(right.groupName ?? ""),
            "uk",
            { sensitivity: "base" }
        );
    });
}


export function tagChipStyle(color) {
    const value = String(color ?? "").trim();
    if (!value) {
        return {
            borderColor: "rgba(255,255,255,.12)",
            color: "#b8becd",
            background: "rgba(255,255,255,.05)",
        };
    }
    return {
        borderColor: `color-mix(in srgb, ${value} 38%, rgba(255,255,255,.12))`,
        color: `color-mix(in srgb, ${value} 55%, #e8ebf5)`,
        background: `color-mix(in srgb, ${value} 12%, rgba(17,20,32,.82))`,
    };
}


export function formatProfileTags(tags) {
    if (!Array.isArray(tags)) return "";
    return tags
        .map((tag) => String(tag?.name ?? tag ?? "").trim())
        .filter(Boolean)
        .join(", ");
}


export function sortProfiles(profiles, column, direction) {
    const sign = direction === "desc" ? -1 : 1;
    return [...profiles].sort((left, right) => {
        if (column === "profileNo") {
            return sign * String(left.profileNo ?? "").localeCompare(
                String(right.profileNo ?? ""),
                "uk",
                { numeric: true }
            );
        }
        if (column === "tags") {
            return sign * formatProfileTags(left.tags).localeCompare(
                formatProfileTags(right.tags),
                "uk",
                { sensitivity: "base" }
            );
        }
        return sign * String(left.name ?? "").localeCompare(
            String(right.name ?? ""),
            "uk",
            { sensitivity: "base" }
        );
    });
}
