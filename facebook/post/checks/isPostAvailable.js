import { availablePostSelector } from "../../selectors/post.js";


export { availablePostSelector };


export default async function isPostAvailable(page) {
    try {
        const post = await page.$(availablePostSelector);

        if (post) {
            await post.dispose();
            return true;
        }

        console.error("Контент Facebook-поста недоступний");
        return false;
    } catch (error) {
        console.error(
            "Контент Facebook-поста недоступний:",
            error.message
        );
        return false;
    }
}
