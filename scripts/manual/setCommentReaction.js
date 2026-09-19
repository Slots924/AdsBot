import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import setCommentReaction from "../../facebook/actions/setCommentReaction.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import isPostAvailable from "../../facebook/post/checks/isPostAvailable.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


function printUsage() {
    console.log(
        "Використання: node scripts/manual/setCommentReaction.js "
        + "<profileNo> <postUrl> [commentId] <reaction>"
    );
    console.log(
        "Якщо commentId не вказаний: node ... <profileNo> <postUrl> <reaction>"
    );
}


function parseArguments() {
    const [, , profileNo, postUrl, third, fourth] = process.argv;

    if (!profileNo || !postUrl || !third || fourth === "") {
        printUsage();
        return null;
    }

    return {
        profileNo: Number(profileNo),
        postUrl,
        targetCommentId: fourth ? third : null,
        reaction: fourth ?? third,
    };
}


async function main() {
    const input = parseArguments();
    if (!input || !Number.isInteger(input.profileNo)) {
        process.exitCode = 1;
        return;
    }

    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=== Встановлення реакції на коментар Facebook ===");
    console.log(`AdsPower-профіль: ${input.profileNo}`);
    console.log(`Посилання на пост: ${input.postUrl}`);
    console.log(`ID коментаря: ${input.targetCommentId ?? "перший у черзі"}`);
    console.log(`Реакція: ${input.reaction}`);

    try {
        const profile = await adsPower.getProfileByNo(input.profileNo);
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до відкриття");
        }

        const browserData = await adsPower.openProfile(input.profileNo);
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        await openPageWithoutPopups(page, input.postUrl);

        if (!await ensureFacebookAccountLoggedIn(adsPower, profile, page)) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }
        if (!await ensureFacebookAccountActive(adsPower, profile, page)) {
            throw new Error("Facebook-акаунт неактивний");
        }
        if (!await isPostAvailable(page)) {
            throw new Error("Facebook-пост недоступний");
        }

        const result = await setCommentReaction(page, {
            commentId: input.targetCommentId,
            reaction: input.reaction,
        });
        console.log("Результат реакції:", result);
        if (result.status === "FAILED") {
            process.exitCode = 1;
        }
        console.log("Готово. Профіль і сторінка залишені відкритими для перевірки.");
    } catch (error) {
        console.error("Помилка діагностичного скрипта:", error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        browser?.disconnect();
        if (profileOpened) {
            console.log(`Профіль ${input.profileNo} залишено відкритим`);
        }
    }
}


main();
