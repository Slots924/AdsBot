import expandCommentReplies from "../actions/expandCommentReplies.js";
import scrollCommentsDown from "../actions/scrollCommentsDown.js";
import sortCommentsByNewest from "../actions/sortCommentsByNewest.js";
import {
    allEmbeddedPostCommentSelector,
    postDialogSelector,
    topLevelCommentSelector,
} from "../selectors/post.js";


const maxTopLevelComments = 50;
const stableScrollLimit = 3;


async function getTopLevelCommentCount(page) {
    return page.evaluate(
        (modalSelector, embeddedSelector) => Array.from(
            document.querySelectorAll(`${modalSelector}, ${embeddedSelector}`)
        ).filter((element) => element.matches('[aria-label^="Comment by " i]')).length,
        topLevelCommentSelector,
        allEmbeddedPostCommentSelector
    );
}


export default async function loadAllPostComments(
    page,
    { expandReplies = true } = {}
) {
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

        await page.waitForFunction(
            (dialogSelector, embeddedSelector) => (
                document.querySelector(dialogSelector)
                || document.querySelector(embeddedSelector)
            ),
            { timeout: 15000 },
            postDialogSelector,
            allEmbeddedPostCommentSelector
        );

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
            if (expandReplies && !await expandCommentReplies(page)) {
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

        if (expandReplies && !await expandCommentReplies(page)) {
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
