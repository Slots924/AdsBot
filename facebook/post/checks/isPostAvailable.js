export const availablePostSelector =
    'div[role="dialog"] div[class^="html-div"] > *'
    + ' > div[data-visualcompletion="ignore-dynamic"]'
    + ' > div > div:nth-of-type(1)';


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
