import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import isPostAvailable from "../../facebook/post/checks/isPostAvailable.js";
import replyToComment from "../../facebook/workflows/replyToComment.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const defaultProfileNo = 1418;
const defaultPostUrl = "https://www.facebook.com/share/p/1CDff3ATzC/";
const targetCommentText =
    "Aitäh, see sait on tõeline kullakaevandus. Kõik teavad seal, mille pärast nad tulid - kirjutad, saad kokku, teed oma asja ja lähed rahulolevalt koju. Mitte nagu teistel saitidel, kus pead päevi kirjutama, siis kohvi jooma, lilli ostma ja lõpuks kuulma, et \"me ei sobi teineteisele\". Vend, sa oled parim.";

const replyVariants = [
    "That is a thoughtful way to describe the difference.",
    "I see what you mean; the comparison is quite relatable.",
    "That sounds like a very practical perspective.",
    "Interesting point, and the contrast is easy to understand.",
    "I appreciate how clearly you explained that experience.",
    "That is a fair observation about keeping things simple.",
    "The way you put it makes the difference quite clear.",
    "I can understand why that approach feels more comfortable.",
    "That is an interesting comparison between the two experiences.",
    "You captured the idea in a straightforward and memorable way.",
    "It sounds like convenience is an important part of the experience.",
    "That perspective makes a lot of sense in this context.",
    "I understand the point you are making about unnecessary steps.",
    "That is a concise way to describe what makes the experience different.",
    "The contrast you mentioned is quite easy to recognize.",
    "It is interesting how much simpler the process can feel.",
    "That sounds like a reasonable preference for a more direct experience.",
    "I like the practical tone of your description.",
    "You make a good point about avoiding unnecessary complications.",
    "That is a clear and relatable summary of the experience.",
];


function getArgumentValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index < 0) return null;

    const value = process.argv[index + 1]?.trim();
    return value || null;
}


function getReplyText() {
    const replyIndex = process.argv.indexOf("--reply");
    if (replyIndex >= 0) {
        const providedReply = process.argv
            .slice(replyIndex + 1)
            .join(" ")
            .trim();

        if (providedReply) return providedReply;
    }

    const randomIndex = Math.floor(Math.random() * replyVariants.length);
    return replyVariants[randomIndex];
}


function printUsage() {
    console.log(
        "Використання: node scripts/manual/writeReplyToTargetComment.js "
        + "[--profile <profileNo>] [--post <postUrl>] [--reply \"текст\"]"
    );
    console.log("Без --reply буде вибрано випадковий англомовний варіант.");
}


async function main() {
    if (process.argv.includes("--help")) {
        printUsage();
        return;
    }

    const profileNo = Number(
        getArgumentValue("--profile") ?? defaultProfileNo
    );
    const postUrl = getArgumentValue("--post") ?? defaultPostUrl;
    const replyText = getReplyText();

    if (!Number.isInteger(profileNo) || profileNo <= 0) {
        throw new Error("profileNo має бути додатним цілим числом");
    }

    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=== Написання reply до вказаного коментаря ===");
    console.log(`AdsPower-профіль: ${profileNo}`);
    console.log(`Посилання на пост: ${postUrl}`);
    console.log(`Цільовий коментар: ${targetCommentText}`);
    console.log(`Текст reply: ${replyText}`);

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) {
            throw new Error(`Профіль AdsPower ${profileNo} не знайдено`);
        }

        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error(
                "AdsPower-профіль не готовий до відкриття"
            );
        }

        const browserData = await adsPower.openProfile(profileNo);
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });

        await openPageWithoutPopups(page, postUrl);

        if (!await ensureFacebookAccountLoggedIn(adsPower, profile, page)) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        if (!await ensureFacebookAccountActive(adsPower, profile, page)) {
            throw new Error("Facebook-акаунт неактивний");
        }

        if (!await ensureEnglish(page)) {
            throw new Error("Не вдалося встановити англійську мову Facebook");
        }

        if (!await isPostAvailable(page)) {
            throw new Error("Facebook-пост недоступний");
        }

        const replyPublished = await replyToComment(
            page,
            targetCommentText,
            replyText
        );

        if (!replyPublished) {
            throw new Error("Не вдалося опублікувати reply");
        }

        console.log("Reply успішно опубліковано");
    } catch (error) {
        console.error("Помилка manual-скрипту:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        browser?.disconnect();
        if (profileOpened) {
            console.log(
                `Профіль ${profileNo} залишено відкритим для перевірки`
            );
        }
    }
}


main();
