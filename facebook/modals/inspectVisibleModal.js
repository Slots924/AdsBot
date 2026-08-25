import { personalProfileCreatePostDialogSelector }
    from "../selectors/personalProfilePost.js";
import { postPublishModalSelectors } from "../selectors/postPublishModals.js";


function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}


export function classifyPostPublishModal({
    title = "",
    ariaLabel = "",
} = {}) {
    const haystack = `${normalizeText(title)} ${normalizeText(ariaLabel)}`;

    if (haystack.includes("review audience")) {
        return "reviewAudience";
    }

    if (haystack.includes("who can see your future posts")) {
        return "futurePostsAudience";
    }

    if (
        haystack.includes("create post")
        || haystack.includes("create a post")
    ) {
        return "createPost";
    }

    if (haystack.trim()) return "unknown";
    return null;
}


export default async function inspectVisibleModal(page) {
    return page.evaluate((selectors, createPostSelector) => {
        const visible = (node) => {
            if (!node) return false;
            const rectangle = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        };
        const normalize = (value) => String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase();
        const createPostVisible = visible(
            document.querySelector(createPostSelector)
        );
        const dialogs = Array.from(
            document.querySelectorAll(selectors.dialog)
        ).filter(visible);
        const extra = [...dialogs].reverse().find((dialog) => {
            const label = normalize(dialog.getAttribute("aria-label"));
            const heading = normalize(
                dialog.querySelector(selectors.title)?.textContent
            );
            const isCreatePost = label.includes("create post")
                || label.includes("create a post")
                || heading.includes("create post")
                || heading.includes("create a post");
            return !isCreatePost;
        }) ?? null;
        const title = extra
            ? String(
                extra.querySelector(selectors.title)?.textContent ?? ""
            ).replace(/\s+/g, " ").trim()
            : "";
        const ariaLabel = extra
            ? String(extra.getAttribute("aria-label") ?? "").trim()
            : "";
        const haystack = `${normalize(title)} ${normalize(ariaLabel)}`;
        let kind = null;
        if (haystack.includes("review audience")) kind = "reviewAudience";
        else if (haystack.includes("who can see your future posts")) {
            kind = "futurePostsAudience";
        }         else if (
            haystack.includes("create post")
            || haystack.includes("create a post")
        ) kind = "createPost";
        else if (extra) kind = "unknown";

        return {
            createPostVisible,
            found: Boolean(extra),
            kind,
            title,
            ariaLabel,
        };
    }, postPublishModalSelectors, personalProfileCreatePostDialogSelector);
}
