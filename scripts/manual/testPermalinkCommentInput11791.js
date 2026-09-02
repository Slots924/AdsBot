import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import { waitForDomQuiet } from "../../facebook/browser/confirmedClick.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../../facebook/browser/elements.js";
import { humanClickElement } from "../../facebook/browser/pointer.js";
import { wait } from "../../facebook/browser/timing.js";
import openPageWithoutPopups
    from "../../facebook/actions/openPageWithoutPopups.js";
import openFacebookPostViaAuthorPage
    from "../../facebook/actions/openFacebookPostViaAuthorPage.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive
    from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn
    from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";
import { commentInputSelector } from "../../facebook/selectors/post.js";


const profileNo = 1791;
const postUrl = "https://www.facebook.com/permalink.php?story_fbid=pfbid08fss2D1EcEbiJm2a5sVUTdwMhcnQ41aJ4iePsnJ7xgRUARXZZrx2cnvMs6rkj9qUl&id=61592141946590";
const inputTimeout = 15000;


async function highlightCommentInput(element) {
    return element.evaluate((target) => {
        target.style.setProperty("outline", "4px solid #ff0000", "important");
        target.style.setProperty("outline-offset", "3px", "important");
        target.style.setProperty(
            "background-color",
            "rgba(255, 0, 0, 0.18)",
            "important"
        );

        return {
            ariaLabel: target.getAttribute("aria-label"),
            text: target.innerText?.trim() ?? "",
        };
    });
}


async function run() {
    const adsPower = new AdsPower();
    let browser;
    let commentInput;

    try {
        console.log(`Відкриваємо AdsPower-профіль ${profileNo}`);
        const profile = await adsPower.getProfileByNo(profileNo);
        const profileReady = await ensureAdsPowerProfileReady(adsPower, profile);

        if (!profileReady) {
            throw new Error("AdsPower-профіль не готовий до відкриття");
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        const windowResult = await configureFacebookAutomationWindow(page, {
            browserMode: "visible",
        });
        console.log("Розмір вікна встановлено", windowResult);

        await openPageWithoutPopups(page, "https://www.facebook.com/");
        const loggedIn = await ensureFacebookAccountLoggedIn(
            adsPower,
            profile,
            page
        );
        if (!loggedIn) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        const active = await ensureFacebookAccountActive(
            adsPower,
            profile,
            page
        );
        if (!active) {
            throw new Error("Facebook-акаунт не активний");
        }

        const postResult = await openFacebookPostViaAuthorPage(page, {
            postUrl,
            timeout: inputTimeout,
            logger: console,
        });
        console.dir(postResult, { depth: null });

        if (!postResult.success) {
            throw new Error(
                `Не вдалося відкрити потрібний допис: ${postResult.status}`
            );
        }

        console.log("Чекаємо поле нового коментаря", {
            selector: commentInputSelector,
            timeout: inputTimeout,
        });
        const initialInput = await waitForVisibleElement(
            page,
            commentInputSelector,
            { timeout: inputTimeout }
        );
        await initialInput.dispose();

        const domQuiet = await waitForDomQuiet(
            page,
            { selector: commentInputSelector },
            { quietMs: 300, timeout: 5000 }
        );
        console.log("Стабілізація DOM поля коментаря", { domQuiet });

        commentInput = await getFirstVisibleElement(
            page,
            commentInputSelector
        );
        if (!commentInput) {
            throw new Error("Поле коментаря зникло після стабілізації DOM");
        }

        const highlighted = await highlightCommentInput(commentInput);
        console.log("Поле коментаря обведено червоним", highlighted);

        console.log("Чекаємо 1,5 секунди перед кліком");
        await wait(1500);

        console.log("Клікаємо ЛКМ по полю коментаря");
        await humanClickElement(page, commentInput, {
            beforeDelay: null,
            holdDelay: [70, 160],
        });

        const focused = await commentInput.evaluate(
            (target) => document.activeElement === target
        );
        console.log("Результат фокусу поля коментаря", { focused });
    } catch (error) {
        console.error("Тест поля коментаря завершився помилкою:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        await commentInput?.dispose().catch(() => {});
        await browser?.disconnect();
        console.log(`Профіль ${profileNo} залишено відкритим для перевірки`);
    }
}


run();
