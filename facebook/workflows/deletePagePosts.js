function normalizeFailure(error) {
    return {
        message: String(error?.message || "Не вдалося видалити публікацію"),
        code: error?.code ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
    };
}


/**
 * Послідовно видаляє передані публікації та повертає частковий результат.
 * Послідовність навмисна: масове видалення не створює сплеск Graph-запитів.
 */
export default async function deletePagePosts({ posts, deletePost } = {}) {
    if (!Array.isArray(posts)) {
        throw new TypeError("Публікації для видалення мають бути масивом");
    }
    if (typeof deletePost !== "function") {
        throw new TypeError("Не передано deletePost для видалення публікацій");
    }

    const ids = [...new Set(posts.map((post) => (
        typeof post === "object" ? post?.id ?? post?.postId : post
    )).map((id) => String(id ?? "").trim()).filter(Boolean))];
    const result = { deleted: [], failed: [] };

    for (const id of ids) {
        try {
            await deletePost(id);
            result.deleted.push({ id });
        } catch (error) {
            result.failed.push({ id, error: normalizeFailure(error) });
        }
    }

    return result;
}
