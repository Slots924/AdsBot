import changeProfilePicture
    from "../../facebook/api-actions/profile/changeProfilePicture.js";
import changeCoverPhoto
    from "../../facebook/api-actions/profile/changeCoverPhoto.js";
import changeFacebookNameWorkflow
    from "../../facebook/api-workflows/accounts/changeFacebookName.js";
import clearProfilePosts, {
    clearProfilePostsStatuses,
} from "../../facebook/api-workflows/profile/clearProfilePosts.js";
import publishProfilePostsWithDates
    from "../../facebook/api-workflows/profile/publishProfilePostsWithDates.js";
import fillProfileAbout
    from "../../facebook/api-workflows/profile/fillProfileAbout.js";
import {
    facebookPersonalProfilePostDeletionStatuses,
} from "../../facebook/actions/deleteAllFacebookPersonalProfilePosts.js";
import executeCommentAccountSetupWithProfile
    from "./executeCommentAccountSetupWithProfile.js";


function emitInfo(logger, event, message, fields = {}) {
    if (typeof logger?.info !== "function") return;
    logger.info(event, message, fields);
}


function emitWarning(logger, event, message, fields = {}) {
    if (typeof logger?.warn !== "function") return;
    logger.warn(event, message, fields);
}


// Підміняє лише Facebook UI-дії API-реалізаціями, залишаючи спільний lifecycle профілю та звіт.
export default async function executeCommentAccountApiSetupWithProfile(options = {}) {
    const logger = options.logger ?? console;
    const actions = {
        changeName: async (page, { firstName, lastName }) => {
            const result = await changeFacebookNameWorkflow({
                page,
                firstName,
                lastName,
            });
            if (result.success) {
                emitInfo(
                    logger,
                    "facebook.api_setup.name",
                    `Ім'я змінено на ${firstName} ${lastName}`
                );
            }
            return result;
        },
        changeAvatar: async (page, { imagePath }) => {
            const result = await changeProfilePicture({
                page,
                imagePath,
            });
            if (result.success) {
                emitInfo(logger, "facebook.api_setup.avatar", "Аватар успішно змінено");
            }
            return result;
        },
        changeCover: async (page, { imagePath }) => {
            const result = await changeCoverPhoto({
                page,
                imagePath,
            });
            if (result.success) {
                emitInfo(logger, "facebook.api_setup.cover", "Обкладинку успішно змінено");
            }
            return result;
        },
        deletePosts: async (page) => {
            const result = await clearProfilePosts({ page });
            if (result.success) {
                emitInfo(
                    logger,
                    "facebook.api_setup.posts_cleared",
                    `Видалено ${result.deletedCount}, приховано системних ${result.hiddenCount}`
                );
            }
            return {
                ...result,
                status: result.status === clearProfilePostsStatuses.NO_POSTS
                    ? facebookPersonalProfilePostDeletionStatuses.NO_POSTS
                    : (result.success
                        ? facebookPersonalProfilePostDeletionStatuses.CLEANED
                        : result.status),
                error: result.success
                    ? null
                    : { message: result.error || result.status },
            };
        },
        publishPosts: async (page, { posts }) => {
            const result = await publishProfilePostsWithDates({
                page,
                posts,
            });
            emitInfo(
                logger,
                "facebook.api_setup.posts_published",
                `Опубліковано й датовано ${result.backdatedCount}/${result.requestedCount} постів`
            );
            return {
                ...result,
                error: result.success
                    ? null
                    : { message: result.error || result.status },
            };
        },
        fillAbout: async (page, { fields, skipBio }) => {
            const result = await fillProfileAbout({
                page,
                fields: {
                    ...fields,
                },
                skipBio,
            });
            const education = result.steps?.education;
            const work = result.steps?.work;
            const bio = result.steps?.bio;
            if (bio?.success && !bio.skipped) {
                emitInfo(logger, "facebook.api_setup.bio", "Bio очищено");
            } else if (!bio?.skipped) {
                emitWarning(
                    logger,
                    "facebook.api_setup.bio_failed",
                    "Не вдалося очистити Bio",
                    {
                        status: bio?.status ?? "UNKNOWN",
                        error: bio?.error ?? null,
                    }
                );
            }
            if (education?.success) {
                emitInfo(
                    logger,
                    "facebook.api_setup.education",
                    education.status === "ALREADY_EXISTS"
                        ? "Освіта вже є, крок пропущено"
                        : `Освіту додано${education.fallback ? " через fallback" : ""}`
                );
            }
            if (work?.success) {
                emitInfo(
                    logger,
                    "facebook.api_setup.work",
                    work.status === "ALREADY_EXISTS"
                        ? "Робота вже є, крок пропущено"
                        : `Роботу додано${work.fallback ? " через fallback" : ""}`
                );
            }
            return {
                ...result,
                error: result.success
                    ? null
                    : { message: result.error || result.status },
            };
        },
    };

    return executeCommentAccountSetupWithProfile({
        ...options,
        skipEnsureEnglish: true,
        skipPageTransitions: true,
        skipHumanDelays: true,
        skipBrowserWindowConfiguration: true,
        actions,
    });
}
