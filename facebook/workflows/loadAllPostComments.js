import expandCommentReplies from "../actions/expandCommentReplies.js";
import scrollCommentsDown from "../actions/scrollCommentsDown.js";
import sortCommentsByNewest from "../actions/sortCommentsByNewest.js";
import {
    postDialogSelector,
    topLevelCommentSelector,
} from "../selectors/post.js";


const maxTopLevelComments = 50;
const stableScrollLimit = 3;


async function getTopLevelCommentCount(page) {
    return page.evaluate(
        (selector) =>
            document.querySelectorAll(selector).length,
        topLevelCommentSelector
    );
}


export default async function loadAllPostComments(page) {
    let stableScrolls = 0;

    try {
        console.log("Сортуємо коментарі за найновішими...");

        try {
            const commentsSorted =
                await sortCommentsByNewest(page);

            console.log(
                `Результат sortCommentsByNewest: ${commentsSorted}`
            );
        } catch (error) {
            console.error(
                "Не вдалося виконати sortCommentsByNewest, продовжуємо завантаження коментарів:",
                error.message
            );
        }

        await page.waitForSelector(postDialogSelector, {
            visible: true,
            timeout: 15000,
        });

        let commentCount = await getTopLevelCommentCount(page);
        console.log(
            `Завантажено основних коментарів: ${commentCount}`
        );

        if (commentCount === 0) {
            console.log("Пост не має завантажених коментарів");
            return true;
        }

        while (
            commentCount < maxTopLevelComments
            && stableScrolls < stableScrollLimit
        ) {
            if (!await expandCommentReplies(page)) {
                return false;
            }

            const countBeforeScroll =
                await getTopLevelCommentCount(page);

            if (countBeforeScroll >= maxTopLevelComments) {
                commentCount = countBeforeScroll;
                break;
            }

            if (!await scrollCommentsDown(page)) {
                return false;
            }

            commentCount = await getTopLevelCommentCount(page);
            console.log(
                `Основних коментарів після прокрутки: ${commentCount}`
            );

            if (commentCount > countBeforeScroll) {
                stableScrolls = 0;
            } else {
                stableScrolls += 1;
                console.log(
                    `Нові коментарі не з'явилися: ${stableScrolls}/${stableScrollLimit}`
                );
            }
        }

        if (!await expandCommentReplies(page)) {
            return false;
        }

        commentCount = await getTopLevelCommentCount(page);

        if (commentCount >= maxTopLevelComments) {
            console.log(
                `Досягнуто ліміт: ${commentCount} основних коментарів`
            );
        } else {
            console.log(
                `Завантажено всі доступні коментарі: ${commentCount}`
            );
        }

        return true;
    } catch (error) {
        console.error(
            "Не вдалося завантажити всі коментарі поста:",
            error.message
        );
        return false;
    }
}
