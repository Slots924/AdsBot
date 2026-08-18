import setPostReaction from "./setPostReaction.js";


const POST_REACTIONS = ["like", "love", "wow"];


export default async function setRandomPostReaction(page) {
    try {
        const reactionIndex = Math.floor(
            Math.random() * POST_REACTIONS.length
        );

        return await setPostReaction(
            page,
            POST_REACTIONS[reactionIndex]
        );
    } catch (error) {
        console.error(
            "Не вдалося поставити випадкову реакцію, продовжуємо роботу:",
            error.message
        );
        return false;
    }
}
