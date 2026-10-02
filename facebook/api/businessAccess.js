export const businessAssetTasks = {
    pages: ["MANAGE", "CREATE_CONTENT", "MODERATE", "MESSAGING", "ADVERTISE", "ANALYZE"],
    adAccounts: ["MANAGE", "ADVERTISE", "ANALYZE"],
};

export function businessAssetAssignment(asset, userId) {
    return asset.assignedUsers?.find((user) => String(user.id) === String(userId));
}

export function hasFullBusinessAccess(asset, userId, kind) {
    const tasks = businessAssetAssignment(asset, userId)?.tasks ?? [];
    return tasks.includes("PROFILE_PLUS_FULL_CONTROL") || businessAssetTasks[kind].every((task) => tasks.includes(task));
}
