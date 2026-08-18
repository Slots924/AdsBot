const linkPlaceholder = "<LINK>";


function createPreparationError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function normalizeSiteUrl(siteUrl) {
    const value = String(siteUrl ?? "").trim();
    let url;

    try {
        url = new URL(value);
    } catch {
        throw createPreparationError(
            "Посилання сайту має бути валідним HTTP або HTTPS URL",
            "CREATIVE_LINK_VALIDATION_ERROR"
        );
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        throw createPreparationError(
            "Посилання сайту має використовувати HTTP або HTTPS",
            "CREATIVE_LINK_VALIDATION_ERROR"
        );
    }

    return value;
}


function normalizeOptionalSiteUrl(siteUrl) {
    const value = String(siteUrl ?? "").trim();

    return value ? normalizeSiteUrl(value) : "";
}


function replaceLink(text, siteUrl) {
    const matches = text.split(linkPlaceholder).length - 1;

    return {
        text: text.split(linkPlaceholder).join(siteUrl),
        matches,
    };
}


/**
 * Створює копію креативу й підставляє URL замість усіх точних <LINK>.
 * @param {object} options Дані кампанії.
 * @param {{creative: string, comments: object[]}} options.creative Креатив-шаблон.
 * @param {string} options.siteUrl HTTP або HTTPS посилання сайту.
 * @returns {{creative: string, comments: object[]}}
 * @throws {Error} CREATIVE_LINK_VALIDATION_ERROR або CREATIVE_LINK_PLACEHOLDER_NOT_FOUND.
 */
export default function prepareCreativeForCampaign({
    creative,
    siteUrl,
} = {}) {
    if (
        !creative
        || typeof creative !== "object"
        || typeof creative.creative !== "string"
        || !Array.isArray(creative.comments)
        || creative.comments.some(
            (comment) => !comment || typeof comment.text !== "string"
        )
    ) {
        throw createPreparationError(
            "Креатив має містити текст creative і масив comments",
            "CREATIVE_LINK_VALIDATION_ERROR"
        );
    }

    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    const preparedMainText = replaceLink(
        creative.creative,
        normalizedSiteUrl
    );
    let placeholderCount = preparedMainText.matches;

    const comments = creative.comments.map((comment) => {
        const preparedComment = replaceLink(
            comment.text,
            normalizedSiteUrl
        );
        placeholderCount += preparedComment.matches;

        return {
            ...comment,
            text: preparedComment.text,
        };
    });

    if (placeholderCount === 0) {
        throw createPreparationError(
            "У креативі та коментарях не знайдено маркер <LINK>",
            "CREATIVE_LINK_PLACEHOLDER_NOT_FOUND"
        );
    }

    return {
        creative: preparedMainText.text,
        comments,
    };
}


/**
 * Підставляє необов'язковий URL лише в копію коментарів креативу.
 * @param {object} options Дані кампанії коментування.
 * @param {{comments: object[]}} options.creative Креатив із коментарями.
 * @param {string} [options.siteUrl] Необов'язкове HTTP/HTTPS посилання.
 * @returns {object[]}
 * @throws {Error} CREATIVE_LINK_VALIDATION_ERROR.
 */
export function prepareCommentsForCampaign({
    creative,
    siteUrl = "",
} = {}) {
    if (
        !creative
        || typeof creative !== "object"
        || !Array.isArray(creative.comments)
        || creative.comments.some(
            (comment) => !comment || typeof comment.text !== "string"
        )
    ) {
        throw createPreparationError(
            "Креатив має містити масив comments",
            "CREATIVE_LINK_VALIDATION_ERROR"
        );
    }

    const normalizedSiteUrl = normalizeOptionalSiteUrl(siteUrl);

    return creative.comments.map((comment) => ({
        ...comment,
        text: replaceLink(comment.text, normalizedSiteUrl).text,
    }));
}
