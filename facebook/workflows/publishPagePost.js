const verificationAttempts = 5;
const verificationDelayMs = 1000;


function createWorkflowError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function normalizeImage(image) {
    if (image === undefined || image === null) {
        return null;
    }

    const filename = String(image?.filename ?? "").trim();
    const contentType = String(image?.contentType ?? "")
        .trim()
        .toLowerCase();

    if (!Buffer.isBuffer(image?.buffer) || image.buffer.length === 0) {
        throw createWorkflowError(
            "Зображення має містити непорожній Buffer",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    if (!filename) {
        throw createWorkflowError(
            "Для зображення не вказано filename",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    if (!contentType.startsWith("image/")) {
        throw createWorkflowError(
            "contentType має описувати зображення",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    return {
        buffer: image.buffer,
        filename,
        contentType,
    };
}


function wait(delayMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}


async function resolvePhotoPostId({
    facebookApiClient,
    photoId,
    pageAccessToken,
}) {
    for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
        try {
            const postId = await facebookApiClient.getPhotoPostId({
                photoId,
                pageAccessToken,
            });

            if (postId) {
                return postId;
            }
        } catch (error) {
            if (attempt === verificationAttempts) {
                throw error;
            }
        }

        if (attempt < verificationAttempts) {
            await wait(verificationDelayMs);
        }
    }

    return null;
}


async function verifyPublishedPost({
    facebookApiClient,
    postId,
    pageAccessToken,
}) {
    let lastError = null;

    for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
        try {
            const post = await facebookApiClient.getPagePost({
                postId,
                pageAccessToken,
            });

            if (
                String(post.id) === String(postId)
                && post.isPublished !== false
            ) {
                return post;
            }
        } catch (error) {
            lastError = error;
        }

        if (attempt < verificationAttempts) {
            await wait(verificationDelayMs);
        }
    }

    throw createWorkflowError(
        "Facebook повернув ID, але не вдалося підтвердити публікацію поста",
        "FACEBOOK_POST_VERIFICATION_FAILED",
        {
            postId,
            verificationErrorCode: lastError?.code ?? null,
        }
    );
}


/**
 * Публікує текстовий або фотопост на вибраній фанпейджі та перевіряє результат.
 * @param {object} options Дані публікації.
 * @param {object} options.facebookApiClient FacebookGraphApiClient вибраного профілю.
 * @param {string} options.pageId ID фанпейджі.
 * @param {string} [options.message] Текст поста.
 * @param {{buffer: Buffer, filename: string, contentType: string}} [options.image] Одна фотографія.
 * @returns {Promise<object>}
 * @throws {Error} FACEBOOK_POST_VALIDATION_ERROR, FACEBOOK_PAGE_NOT_FOUND,
 * FACEBOOK_PAGE_PUBLISH_FORBIDDEN, FACEBOOK_POST_OUTCOME_UNKNOWN або
 * FACEBOOK_POST_VERIFICATION_FAILED.
 */
export default async function publishPagePost({
    facebookApiClient,
    pageId,
    message = "",
    image,
    images = [],
} = {}) {
    if (
        !facebookApiClient?.getFanPageById
        || !facebookApiClient?.createPageTextPost
        || !facebookApiClient?.createPagePhotoPost
        || !facebookApiClient?.getPagePost
    ) {
        throw createWorkflowError(
            "Не передано коректний FacebookGraphApi",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    const normalizedPageId = String(pageId ?? "").trim();
    const normalizedMessage = String(message ?? "").trim();
    const normalizedImages = (Array.isArray(images) && images.length
        ? images
        : image === undefined ? [] : [image]
    ).map(normalizeImage);
    const normalizedImage = normalizedImages[0] ?? null;

    if (!normalizedPageId) {
        throw createWorkflowError(
            "Не вказано ID фанпейджі",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    if (!normalizedMessage && !normalizedImage) {
        throw createWorkflowError(
            "Пост має містити текст або зображення",
            "FACEBOOK_POST_VALIDATION_ERROR"
        );
    }

    const page = await facebookApiClient.getFanPageById(normalizedPageId);

    if (!page) {
        throw createWorkflowError(
            `Фанпейджу з ID "${normalizedPageId}" не знайдено`,
            "FACEBOOK_PAGE_NOT_FOUND"
        );
    }

    if (!page.pageAccessToken) {
        throw createWorkflowError(
            "Для фанпейджі не отримано Page access token",
            "FACEBOOK_PAGE_PUBLISH_FORBIDDEN"
        );
    }

    let type;
    let postId;

    if (normalizedImage) {
        type = "photo";
        const createdPhoto = normalizedImages.length > 1
            ? await facebookApiClient.createPageMultiPhotoPost({
                pageId: normalizedPageId,
                pageAccessToken: page.pageAccessToken,
                message: normalizedMessage,
                images: normalizedImages,
            })
            : await facebookApiClient.createPagePhotoPost({
                pageId: normalizedPageId,
                pageAccessToken: page.pageAccessToken,
                message: normalizedMessage,
                image: normalizedImage,
            });

        postId = createdPhoto.postId;

        if (!postId && createdPhoto.photoId) {
            postId = await resolvePhotoPostId({
                facebookApiClient,
                photoId: createdPhoto.photoId,
                pageAccessToken: page.pageAccessToken,
            });
        }
    } else {
        type = "text";
        const createdPost = await facebookApiClient.createPageTextPost({
            pageId: normalizedPageId,
            pageAccessToken: page.pageAccessToken,
            message: normalizedMessage,
        });
        postId = createdPost.postId;
    }

    if (!postId) {
        throw createWorkflowError(
            "Facebook не повернув ID створеного поста",
            "FACEBOOK_POST_VERIFICATION_FAILED"
        );
    }

    const post = await verifyPublishedPost({
        facebookApiClient,
        postId,
        pageAccessToken: page.pageAccessToken,
    });

    return {
        postId: post.id,
        pageId: normalizedPageId,
        type,
        message: post.message || normalizedMessage,
        permalinkUrl: post.permalinkUrl,
        createdTime: post.createdTime,
        verified: true,
    };
}
