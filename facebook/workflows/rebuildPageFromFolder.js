import path from "node:path";

import loadImageFromPath from "../../services/images/loadImageFromPath.js";
import createBackdatedSchedule
    from "../../services/pageRebuild/createBackdatedSchedule.js";
import preparePageRebuild
    from "../../services/pageRebuild/preparePageRebuild.js";


function createWorkflowError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function normalizeWarning(error, stage, objectId) {
    return {
        stage,
        objectId: String(objectId ?? ""),
        code: error?.code ?? null,
        graphCode: error?.graphCode ?? null,
        message: String(error?.message || "Meta не виконала необов'язкову дію"),
    };
}


function isOptionalObjectFailure(error) {
    return error?.httpStatus === 404
        || [100, 200, 803].includes(Number(error?.graphCode));
}


function assertNotAborted(signal) {
    if (!signal?.aborted) return;
    throw createWorkflowError(
        "Пересетаплення фанпейджа перервано після безпечного кроку",
        "PAGE_REBUILD_INTERRUPTED",
        { name: "AbortError" }
    );
}


function publicResult(job, resumed) {
    return {
        pageId: job.pageId,
        avatar: job.avatar ? {
            file: path.basename(job.avatar.file),
            photoId: job.avatar.photoId,
        } : null,
        cover: job.cover ? {
            file: path.basename(job.cover.file),
            photoId: job.cover.photoId,
        } : null,
        cleanup: structuredClone(job.cleanup),
        publications: job.publications
            .filter((publication) => publication.verified)
            .map((publication) => ({
                file: path.basename(publication.file),
                photoId: publication.photoId,
                postId: publication.postId,
                backdatedTime: publication.backdatedTime,
            })),
        warnings: structuredClone(job.warnings),
        resumed,
    };
}


async function optionalMutation({ operation, job, journal, stage, objectId }) {
    try {
        await operation();
        return { job, completed: true };
    } catch (error) {
        if (!isOptionalObjectFailure(error)) throw error;
        const warning = normalizeWarning(error, stage, objectId);
        const duplicate = job.warnings.some((item) => (
            item.stage === warning.stage && item.objectId === warning.objectId
        ));
        if (!duplicate) {
            job = await journal.update(job.id, {
                warnings: [...job.warnings, warning],
            });
        }
        return { job, completed: false };
    }
}


function upsertPublication(publications, patch) {
    const index = publications.findIndex((item) => item.file === patch.file);
    if (index === -1) return [...publications, patch];
    return publications.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
    ));
}


/** Повністю переоформлює Page фотографіями з локальної папки. */
export default async function rebuildPageFromFolder({
    facebookApiClient,
    journal,
    accountKey,
    pageId,
    imagesDirectory,
    pageCreatedAt,
    imageLoader = loadImageFromPath,
    prepare = preparePageRebuild,
    createSchedule = createBackdatedSchedule,
    random = Math.random,
    now = new Date(),
    signal,
    onProgress = () => {},
} = {}) {
    if (!facebookApiClient || !journal) {
        throw createWorkflowError(
            "Не передано Facebook API або журнал пересетаплення",
            "PAGE_REBUILD_CONFIG_ERROR"
        );
    }
    const progress = async (payload) => onProgress(payload);
    let job;
    let resumed = false;

    try {
        await progress({
            stage: "validation",
            completed: 0,
            total: 5,
            message: "Перевіряємо фанпейдж і папку з фотографіями",
        });
        const requirements = await facebookApiClient
            .getPageRebuildRequirements({ pageId });
        const createdAt = requirements.pageCreatedAt || String(pageCreatedAt ?? "").trim();
        if (!createdAt) {
            throw createWorkflowError(
                "Meta не повернула дату створення; вкажіть її вручну",
                "PAGE_REBUILD_CREATED_AT_REQUIRED"
            );
        }
        const prepared = await prepare({ imagesDirectory, imageLoader, random });
        const dates = createSchedule({
            count: prepared.posts.length,
            pageCreatedAt: createdAt,
            now,
            random,
        });
        const plan = {
            imagesDirectory: prepared.imagesDirectory,
            pageCreatedAt: createdAt,
            avatar: prepared.avatar,
            cover: prepared.cover,
            posts: prepared.posts.map((image, index) => ({
                ...image,
                backdatedTime: dates[index],
            })),
        };
        ({ job, resumed } = await journal.startOrResume({
            accountKey,
            pageId,
            fingerprint: prepared.fingerprint,
            plan,
        }));
        await progress({
            stage: "validation",
            completed: 1,
            total: 5,
            message: resumed
                ? "Продовжуємо незавершене пересетаплення"
                : "Папка перевірена; план зафіксовано",
        });
        assertNotAborted(signal);

        if (!job.snapshot) {
            const snapshot = await facebookApiClient.getPageRebuildSnapshot({ pageId });
            job = await journal.update(job.id, {
                snapshot,
                stage: "snapshot",
            });
        }
        assertNotAborted(signal);

        if (!job.avatar) {
            await progress({
                stage: "appearance",
                completed: 1,
                total: 5,
                message: "Змінюємо avatar фанпейджа",
            });
            const image = await imageLoader(job.plan.avatar.absolutePath);
            const avatar = await facebookApiClient.setPageProfilePicture({
                pageId,
                image,
                knownPhotoIds: job.snapshot.photos.map((photo) => photo.id),
            });
            job = await journal.update(job.id, {
                avatar: {
                    file: job.plan.avatar.absolutePath,
                    photoId: avatar.photoId,
                },
                stage: "avatar",
            });
        }
        assertNotAborted(signal);

        if (!job.cover?.applied) {
            await progress({
                stage: "appearance",
                completed: 2,
                total: 5,
                message: "Змінюємо обкладинку фанпейджа",
            });
            const image = job.cover?.photoId
                ? undefined
                : await imageLoader(job.plan.cover.absolutePath);
            let cover;
            try {
                cover = await facebookApiClient.setPageCoverPicture({
                    pageId,
                    image,
                    photoId: job.cover?.photoId,
                    knownPhotoIds: [
                        ...job.snapshot.photos.map((photo) => photo.id),
                        job.avatar?.photoId,
                    ].filter(Boolean),
                });
            } catch (error) {
                if (error?.photoId) {
                    job = await journal.update(job.id, {
                        cover: {
                            file: job.plan.cover.absolutePath,
                            photoId: String(error.photoId),
                            applied: false,
                        },
                    });
                }
                throw error;
            }
            job = await journal.update(job.id, {
                cover: {
                    file: job.plan.cover.absolutePath,
                    photoId: cover.photoId,
                    applied: true,
                },
                stage: "cover",
            });
        }
        assertNotAborted(signal);

        const oldPostIds = new Set(job.snapshot.posts.map((post) => String(post.id)));
        const afterAppearance = await facebookApiClient.getPageRebuildSnapshot({ pageId });
        const appearancePhotoIds = new Set([
            String(job.avatar?.photoId ?? ""),
            String(job.cover?.photoId ?? ""),
        ].filter(Boolean));
        const newStories = afterAppearance.posts.filter((post) => (
            !oldPostIds.has(String(post.id))
            && (post.story || appearancePhotoIds.has(String(post.objectId ?? "")))
        ));
        for (const story of newStories) {
            if (job.cleanup.hiddenPostIds.includes(String(story.id))) continue;
            assertNotAborted(signal);
            const result = await optionalMutation({
                operation: () => facebookApiClient.hidePagePost({
                    pageId,
                    postId: story.id,
                }),
                job,
                journal,
                stage: "hide-story",
                objectId: story.id,
            });
            job = result.job;
            if (result.completed) {
                job = await journal.update(job.id, {
                    cleanup: {
                        ...job.cleanup,
                        hiddenPostIds: [...job.cleanup.hiddenPostIds, String(story.id)],
                    },
                });
            }
        }

        await progress({
            stage: "cleanup",
            completed: 3,
            total: 5,
            message: "Видаляємо старі фотографії та пости",
        });
        for (const photo of job.snapshot.photos) {
            const id = String(photo.id);
            if (job.cleanup.deletedPhotoIds.includes(id)) continue;
            assertNotAborted(signal);
            const result = await optionalMutation({
                operation: () => facebookApiClient.deletePageObject({ pageId, objectId: id }),
                job,
                journal,
                stage: "delete-photo",
                objectId: id,
            });
            job = result.job;
            if (result.completed) {
                job = await journal.update(job.id, {
                    cleanup: {
                        ...job.cleanup,
                        deletedPhotoIds: [...job.cleanup.deletedPhotoIds, id],
                    },
                });
            }
        }
        for (const post of job.snapshot.posts) {
            const id = String(post.id);
            if (job.cleanup.deletedPostIds.includes(id)) continue;
            assertNotAborted(signal);
            const result = await optionalMutation({
                operation: () => facebookApiClient.deletePageObject({ pageId, objectId: id }),
                job,
                journal,
                stage: "delete-post",
                objectId: id,
            });
            job = result.job;
            if (result.completed) {
                job = await journal.update(job.id, {
                    cleanup: {
                        ...job.cleanup,
                        deletedPostIds: [...job.cleanup.deletedPostIds, id],
                    },
                });
            }
        }

        await progress({
            stage: "publication",
            completed: 4,
            total: 5,
            message: `Публікуємо ${job.plan.posts.length} фото з минулими датами`,
        });
        for (let index = 0; index < job.plan.posts.length; index += 1) {
            const planned = job.plan.posts[index];
            let publication = job.publications.find(
                (item) => item.file === planned.absolutePath
            );
            if (publication?.verified) continue;
            assertNotAborted(signal);
            if (!publication?.photoId) {
                const image = await imageLoader(planned.absolutePath);
                const uploaded = await facebookApiClient.createUnpublishedPagePhoto({
                    pageId,
                    image,
                    knownPhotoIds: [
                        ...job.snapshot.photos.map((photo) => photo.id),
                        ...job.publications.map((item) => item.photoId),
                        job.avatar?.photoId,
                        job.cover?.photoId,
                    ].filter(Boolean),
                });
                publication = {
                    file: planned.absolutePath,
                    backdatedTime: planned.backdatedTime,
                    photoId: uploaded.photoId,
                    postId: null,
                    verified: false,
                };
                job = await journal.update(job.id, {
                    publications: upsertPublication(job.publications, publication),
                });
            }
            if (!publication.postId) {
                let posted;
                try {
                    posted = await facebookApiClient.createBackdatedPhotoPost({
                        pageId,
                        photoId: publication.photoId,
                        backdatedTime: publication.backdatedTime,
                    });
                } catch (error) {
                    if (error?.code !== "FACEBOOK_BACKDATED_POST_OUTCOME_UNKNOWN") {
                        throw error;
                    }
                    const postId = await facebookApiClient.getPagePhotoStory({
                        pageId,
                        photoId: publication.photoId,
                    });
                    if (!postId) throw error;
                    posted = { postId };
                }
                publication = { ...publication, postId: posted.postId };
                job = await journal.update(job.id, {
                    publications: upsertPublication(job.publications, publication),
                });
            }
            const verified = await facebookApiClient.getPagePostForPage({
                pageId,
                postId: publication.postId,
            });
            if (String(verified.id) !== String(publication.postId)) {
                throw createWorkflowError(
                    "Meta не підтвердила створений фото-пост",
                    "PAGE_REBUILD_POST_VERIFICATION_FAILED",
                    { itemIndex: index }
                );
            }
            publication = { ...publication, verified: true };
            job = await journal.update(job.id, {
                publications: upsertPublication(job.publications, publication),
                stage: "publication",
            });
            await progress({
                stage: "publication",
                completed: 4,
                total: 5,
                current: index + 1,
                count: job.plan.posts.length,
                message: `Опубліковано ${index + 1} із ${job.plan.posts.length} фото`,
            });
        }

        const status = job.warnings.length
            ? "completed_with_warnings"
            : "completed";
        job = await journal.update(job.id, { status, stage: "complete" });
        await progress({
            stage: "complete",
            completed: 5,
            total: 5,
            message: job.warnings.length
                ? `Пересетаплення завершено з попередженнями: ${job.warnings.length}`
                : "Фанпейдж успішно пересетаплено",
        });
        return publicResult(job, resumed);
    } catch (error) {
        if (job?.id) {
            await journal.update(job.id, {
                status: signal?.aborted ? "interrupted" : "failed",
                stage: error?.stage ?? job.stage,
            });
        }
        throw error;
    }
}
