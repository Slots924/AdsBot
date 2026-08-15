import scrollToPostLikeButton from "../actions/scrollToPostLikeButton.js";
import writeComment from "../actions/writeComment.js";


export default async function commentOnPost(page, commentText) {
    await scrollToPostLikeButton(page);

    return writeComment(page, commentText);
}
