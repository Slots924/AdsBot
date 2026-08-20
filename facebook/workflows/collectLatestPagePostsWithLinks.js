const textLinkPattern = /https?:\/\/[^\s]+/i;


function hasLinkInPostText(post) {
    return textLinkPattern.test(String(post?.message ?? ""));
}


/**
 * Серед заданої кількості найновіших опублікованих постів залишає тільки ті,
 * що містять посилання саме в тексті.
 */
export default async function collectLatestPagePostsWithLinks({
    fetchPosts,
    normalizePost = (post) => post,
    limit = 10,
} = {}) {
    if (typeof fetchPosts !== "function") {
        throw new TypeError("Не передано fetchPosts для завантаження постів");
    }

    const posts = await fetchPosts({ limit });
    return (Array.isArray(posts) ? posts : [])
        .filter((post) => post?.is_published !== false)
        .sort((left, right) => (
            new Date(right?.created_time ?? 0)
            - new Date(left?.created_time ?? 0)
        ))
        .slice(0, limit)
        .filter(hasLinkInPostText)
        .map(normalizePost);
}


export { hasLinkInPostText };
