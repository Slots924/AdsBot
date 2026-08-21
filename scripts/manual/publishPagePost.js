import "dotenv/config";

import FacebookBackendService
    from "../../facebook/services/FacebookBackendService.js";


// Ключ Facebook-акаунта з data/facebookApi/accounts.json.
const accountKey = "fp_hub";

// Вкажіть ID фанпейджі, на якій потрібно створити пост.
const fanPageId = "";

// Креатив буде отримано через CreativeManager і підготовлено для сайту.
const geo = "HU";
const creativeName = "138";
const siteUrl = "";

// Залиште порожнім для текстового поста. Підтримуються JPG, JPEG, PNG і WEBP.
const imagePath = "";


async function testPublishPagePost() {
    if (!fanPageId.trim()) {
        console.log(
            "Публікацію не виконано: вкажіть fanPageId на початку файла."
        );
        return;
    }

    const facebookBackend = await FacebookBackendService.create();
    const fanPages = await facebookBackend.getFanPages(accountKey);

    console.log(`Доступні фанпейджі акаунта ${accountKey}:`);
    console.table(fanPages);

    if (!fanPages.some((fanPage) => fanPage.id === fanPageId.trim())) {
        throw new Error(
            `Фанпейджа "${fanPageId}" недоступна для публікації`
        );
    }

    const preparedCreative = await facebookBackend.prepareCreative({
        geo,
        creativeName,
        siteUrl,
    });

    console.log(
        `Публікуємо креатив ${geo} ${creativeName} на фанпейджі ${fanPageId}`
    );

    const post = await facebookBackend.publishPost({
        accountKey,
        pageId: fanPageId,
        message: preparedCreative.creative,
        imagePath,
    });

    console.log("Пост успішно опубліковано та перевірено:");
    console.table([post]);
    console.log(
        `Для сценарію коментування підготовлено коментарів: ${preparedCreative.comments.length}`
    );
}


testPublishPagePost().catch((error) => {
    console.error("Помилка публікації:");
    console.table([{
        message: error.message,
        code: error.code ?? "—",
        httpStatus: error.httpStatus ?? "—",
        graphCode: error.graphCode ?? "—",
        graphSubcode: error.graphSubcode ?? "—",
        postId: error.postId ?? "—",
    }]);
    process.exitCode = 1;
});
