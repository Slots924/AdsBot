import setPostReaction from "./setPostReaction.js";
import { randomInteger } from "../browser/timing.js";


const POST_REACTIONS = ["like", "love", "wow"];


export default async function setRandomPostReaction(page) {
    try {
        const reactionIndex = randomInteger(
            0,
            POST_REACTIONS.length - 1
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
