import writeReply from "../actions/writeReply.js";
import loadAllPostComments from "./loadAllPostComments.js";


export default async function replyToComment(
    page,
    targetCommentText,
    replyText
) {
    try {
        const commentsLoaded = await loadAllPostComments(page);

        if (!commentsLoaded) {
            console.error(
                "Не вдалося завантажити коментарі, продовжуємо пошук потрібного коментаря"
            );
        }
    } catch (error) {
        console.error(
            "Не вдалося завантажити коментарі, продовжуємо пошук потрібного коментаря:",
            error.message
        );
    }

    return writeReply(
        page,
        targetCommentText,
        replyText
    );
}
