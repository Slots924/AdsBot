import { readFile } from "node:fs/promises";
import path from "node:path";

import getProfileGender from "../services/profile/getProfileGender.js";
import saveCommentingReport from "../services/reports/saveCommentingReport.js";
import executeCommentWithProfile from "../workflows/comments/executeCommentWithProfile.js";


function normalizeComment(rawComment, index) {
    return {
        ...rawComment,
        id: String(rawComment?.id ?? "").trim(),
        parent_id: rawComment?.parent_id === null
            ? null
            : String(rawComment?.parent_id ?? "").trim(),
        gender: String(rawComment?.gender ?? "")
            .trim()
            .toLocaleLowerCase(),
        profile_key: rawComment?.profile_key === null
            ? null
            : String(rawComment?.profile_key ?? "").trim() || null,
        rowNumber: index + 1,
    };
}


async function loadComments(commentsFilePath) {
    const absolutePath = path.resolve(commentsFilePath);
    const content = await readFile(absolutePath, "utf8");
    const data = JSON.parse(content);

    if (!Array.isArray(data?.comments)) {
        throw new Error(
            "Файл коментарів не містить масив comments"
        );
    }

    return data.comments.map(normalizeComment);
}


function createReport({
    groupIds,
    commentsFilePath,
    postUrl,
}) {
    return {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        groupIds: normalizeGroupIds(groupIds),
        commentsFilePath: path.resolve(
            String(commentsFilePath ?? "")
        ),
        postUrl,
        fatalError: null,
        published: [],
        skipped: [],
        failedComments: [],
        failedProfiles: [],
        excludedProfiles: [],
        cleanupWarnings: [],
        profileKeyMap: {},
    };
}


function normalizeGroupIds(groupIds) {
    if (!Array.isArray(groupIds)) {
        return [];
    }

    return [...new Set(
        groupIds
            .map((groupId) => String(groupId ?? "").trim())
            .filter(Boolean)
    )];
}


function shuffleArray(items) {
    const shuffledItems = [...items];

    for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));

        [shuffledItems[index], shuffledItems[randomIndex]] =
            [shuffledItems[randomIndex], shuffledItems[index]];
    }

    return shuffledItems;
}


function getCommentLabel(comment) {
    return comment.id || `рядок ${comment.rowNumber}`;
}


function getActionType(comment) {
    return comment.parent_id === null ? "comment" : "reply";
}


function validateSettings({ groupIds, commentsFilePath, postUrl }) {
    if (normalizeGroupIds(groupIds).length === 0) {
        throw new Error("Не вказано ID груп AdsPower");
    }

    if (!String(commentsFilePath ?? "").trim()) {
        throw new Error("Не вказано шлях до файла коментарів");
    }

    let parsedPostUrl;

    try {
        parsedPostUrl = new URL(postUrl);
    } catch {
        throw new Error("Вказано некоректний URL Facebook-поста");
    }

    if (
        !["http:", "https:"].includes(parsedPostUrl.protocol)
        || !parsedPostUrl.hostname.endsWith("facebook.com")
    ) {
        throw new Error("URL має вести на Facebook-пост");
    }
}


export default async function runCommentingScenario({
    adsPower,
    groupIds,
    commentsFilePath,
    postUrl,
    reportsDirectory = "./data/reports",
}) {
    const report = createReport({
        groupIds,
        commentsFilePath,
        postUrl,
    });
    const profileKeyMap = new Map();
    const brokenProfileKeys = new Set();
    const attemptedProfileNos = new Set();
    const publishedCommentIds = new Set();
    let reportPath = null;

    try {
        validateSettings({
            groupIds,
            commentsFilePath,
            postUrl,
        });

        const comments = await loadComments(commentsFilePath);
        const commentsById = new Map();
        const duplicateRows = new Set();

        comments.forEach((comment) => {
            if (!comment.id || commentsById.has(comment.id)) {
                duplicateRows.add(comment.rowNumber);
                return;
            }

            commentsById.set(comment.id, comment);
        });

        const normalizedGroupIds = normalizeGroupIds(groupIds);

        console.log(
            `Отримуємо профілі груп AdsPower: ${normalizedGroupIds.join(", ")}`
        );

        const profilesFromGroups = await Promise.all(
            normalizedGroupIds.map((groupId) =>
                adsPower.getProfilesByGroupId(groupId)
            )
        );
        const uniqueProfiles = [];
        const seenProfileNos = new Set();

        profilesFromGroups.flat().forEach((profile) => {
            const profileNo = String(profile?.profile_no ?? "").trim();

            if (profileNo && seenProfileNos.has(profileNo)) {
                return;
            }

            if (profileNo) {
                seenProfileNos.add(profileNo);
            }

            uniqueProfiles.push(profile);
        });

        const profiles = shuffleArray(uniqueProfiles);

        if (profiles.length === 0) {
            throw new Error(
                `Групи AdsPower ${normalizedGroupIds.join(", ")} порожні або не існують`
            );
        }
        const profilesByNo = new Map();
        const profilePools = {
            male: [],
            female: [],
        };

        profiles.forEach((profile) => {
            const profileNo = String(
                profile?.profile_no ?? ""
            ).trim();
            const gender = getProfileGender(profile);

            if (!profileNo) {
                report.excludedProfiles.push({
                    profileNo: "невідомий",
                    reason: "У профілю відсутній profile_no",
                });
                return;
            }

            if (!gender) {
                report.excludedProfiles.push({
                    profileNo,
                    reason:
                        "Відсутній або неоднозначний гендерний тег",
                });
                return;
            }

            profilesByNo.set(profileNo, profile);
            profilePools[gender].push(profile);
        });

        console.log(
            `Доступні профілі: male=${profilePools.male.length}, female=${profilePools.female.length}`
        );

        const getNextProfile = (gender) =>
            profilePools[gender].find((profile) =>
                !attemptedProfileNos.has(
                    String(profile.profile_no)
                )
            ) ?? null;

        const saveCleanupWarnings = (result) => {
            result.cleanupErrors.forEach((error) => {
                report.cleanupWarnings.push({
                    profileNo: result.profileNo,
                    commentId: result.commentId,
                    error,
                });
            });
        };

        const executeAttempt = async (
            profile,
            comment,
            parentComment
        ) => {
            const profileNo = String(profile.profile_no);
            attemptedProfileNos.add(profileNo);

            console.log(
                `Коментар ${comment.id}: використовуємо профіль ${profileNo}`
            );

            const result = await executeCommentWithProfile({
                adsPower,
                profile,
                postUrl,
                comment,
                parentComment,
            });

            saveCleanupWarnings(result);

            if (!result.success) {
                report.failedProfiles.push({
                    profileNo,
                    commentId: comment.id,
                    stage: result.stage,
                    error: result.error,
                });
            }

            return result;
        };

        const savePublishedComment = (
            comment,
            profile,
            gender
        ) => {
            publishedCommentIds.add(comment.id);
            report.published.push({
                commentId: comment.id,
                actionType: getActionType(comment),
                profileNo: String(profile.profile_no),
                gender,
                profileKey: comment.profile_key,
                text: comment.text,
            });
        };

        for (const comment of comments) {
            const commentLabel = getCommentLabel(comment);

            if (comment.should_write === false) {
                report.skipped.push({
                    commentId: commentLabel,
                    reason: "should_write=false",
                    text: comment.text,
                });
                continue;
            }

            if (comment.should_write !== true) {
                report.skipped.push({
                    commentId: commentLabel,
                    reason: "Некоректне значення should_write",
                    text: comment.text,
                });
                continue;
            }

            if (!comment.id || duplicateRows.has(comment.rowNumber)) {
                report.skipped.push({
                    commentId: commentLabel,
                    reason: !comment.id
                        ? "Відсутній ID коментаря"
                        : "ID коментаря дублюється",
                    text: comment.text,
                });
                continue;
            }

            if (
                typeof comment.text !== "string"
                || comment.text.trim().length === 0
            ) {
                report.skipped.push({
                    commentId: comment.id,
                    reason: "Відсутній текст коментаря",
                    text: comment.text,
                });
                continue;
            }

            if (!["male", "female"].includes(comment.gender)) {
                report.skipped.push({
                    commentId: comment.id,
                    reason: "Не вказано коректний gender",
                    text: comment.text,
                });
                continue;
            }

            let parentComment = null;

            if (comment.parent_id !== null) {
                parentComment = commentsById.get(
                    comment.parent_id
                );

                if (!parentComment) {
                    report.skipped.push({
                        commentId: comment.id,
                        reason:
                            `Не знайдено parent_id=${comment.parent_id}`,
                        text: comment.text,
                    });
                    continue;
                }

                if (
                    parentComment.should_write === true
                    && !publishedCommentIds.has(parentComment.id)
                ) {
                    report.skipped.push({
                        commentId: comment.id,
                        reason:
                            `Батьківський коментар ${parentComment.id} не опубліковано`,
                        text: comment.text,
                    });
                    continue;
                }
            }

            if (
                comment.profile_key
                && brokenProfileKeys.has(comment.profile_key)
            ) {
                report.failedComments.push({
                    commentId: comment.id,
                    actionType: getActionType(comment),
                    reason:
                        `profile_key=${comment.profile_key} недоступний`,
                    attempts: 0,
                    text: comment.text,
                });
                continue;
            }

            if (
                comment.profile_key
                && profileKeyMap.has(comment.profile_key)
            ) {
                const mappedProfileNo = profileKeyMap.get(
                    comment.profile_key
                );
                const mappedProfile = profilesByNo.get(
                    mappedProfileNo
                );
                const mappedGender = getProfileGender(mappedProfile);

                if (mappedGender !== comment.gender) {
                    report.failedComments.push({
                        commentId: comment.id,
                        actionType: getActionType(comment),
                        reason:
                            `Стать profile_key=${comment.profile_key} не відповідає gender=${comment.gender}`,
                        attempts: 0,
                        text: comment.text,
                    });
                    continue;
                }

                const result = await executeAttempt(
                    mappedProfile,
                    comment,
                    parentComment
                );

                if (result.success) {
                    savePublishedComment(
                        comment,
                        mappedProfile,
                        comment.gender
                    );
                } else {
                    brokenProfileKeys.add(comment.profile_key);
                    report.failedComments.push({
                        commentId: comment.id,
                        actionType: getActionType(comment),
                        reason:
                            `Прив’язаний профіль ${mappedProfileNo} завершився помилкою: ${result.error}`,
                        attempts: 1,
                        text: comment.text,
                    });
                }

                continue;
            }

            let attempts = 0;
            let published = false;
            let lastError = null;

            while (true) {
                const profile = getNextProfile(comment.gender);

                if (!profile) {
                    break;
                }

                attempts += 1;
                const result = await executeAttempt(
                    profile,
                    comment,
                    parentComment
                );

                if (!result.success) {
                    lastError = result.error;

                    if (getActionType(comment) === "reply") {
                        break;
                    }

                    continue;
                }

                published = true;
                savePublishedComment(
                    comment,
                    profile,
                    comment.gender
                );

                if (comment.profile_key) {
                    profileKeyMap.set(
                        comment.profile_key,
                        String(profile.profile_no)
                    );
                }

                break;
            }

            if (!published) {
                report.failedComments.push({
                    commentId: comment.id,
                    actionType: getActionType(comment),
                    reason: lastError && getActionType(comment) === "reply"
                        ? `Не вдалося опублікувати reply: ${lastError}`
                        : lastError
                        ? `Усі спроби завершилися помилкою: ${lastError}`
                        : `Закінчилися профілі gender=${comment.gender}`,
                    attempts,
                    text: comment.text,
                });
            }
        }
    } catch (error) {
        report.fatalError = error.message;
        console.error("Критична помилка сценарію:", error.message);
    } finally {
        report.finishedAt = new Date().toISOString();
        report.profileKeyMap = Object.fromEntries(profileKeyMap);

        try {
            reportPath = await saveCommentingReport(
                report,
                reportsDirectory
            );
            console.log(`Звіт збережено: ${reportPath}`);
        } catch (error) {
            console.error(
                "Не вдалося зберегти звіт:",
                error.message
            );
        }
    }

    return {
        report,
        reportPath,
    };
}
