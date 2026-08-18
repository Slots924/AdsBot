import writeComment from "../actions/writeComment.js";


export default async function commentOnPost(page, commentText) {
    return writeComment(page, commentText);
}
