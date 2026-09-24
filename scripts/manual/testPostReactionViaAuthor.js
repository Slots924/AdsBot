import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import ensureFacebookAccountActive
    from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn
    from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import openFacebookPostViaAuthorPage
    from "../../facebook/actions/openFacebookPostViaAuthorPage.js";
import openPageWithoutPopups
    from "../../facebook/actions/openPageWithoutPopups.js";
import setPostReaction
    from "../../facebook/actions/setPostReaction.js";
import { randomInteger } from "../../facebook/browser/timing.js";
import { reactionButtonSelector } from "../../facebook/selectors/reactions.js";


const profileNo = 1753;
const postUrl = "https://www.facebook.com/permalink.php?story_fbid=pfbid032DBtjTuBhVwqYn9nWSZFTzQZGnh4qWynGGHbes7af1AJzF9uJxFys6hpted4Ecabl&id=61550226884614";
const postReactions = ["like", "love", "wow"];


function logStep(step, details = null) {
    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    console.log(`[POST-REACTION] ${step}${suffix}`);
}


async function inspectReactionButtons(page, selector) {
    return page.evaluate((selector) => {
        const visible = (element) => {
            const rectangle = element.getBoundingClientRect();
            const styles = window.getComputedStyle(element);

            return rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden";
        };

        return {
            selector,
            storyMessages: document.querySelectorAll(
                '[data-ad-rendering-role="story_message"]'
            ).length,
            matched: document.querySelectorAll(selector).length,
            visibleButtons: [...document.querySelectorAll(selector)]
                .filter(visible)
                .map((element) => ({
                    tagName: element.tagName,
                    role: element.getAttribute("role"),
                    ariaLabel: element.getAttribute("aria-label"),
                    text: element.innerText?.trim() ?? "",
                })),
        };
    }, selector);
}


async function waitForExit() {
    console.log("[POST-REACTION] Браузер залишено відкритим. Натисни Enter у консолі для завершення.");
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve));
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=== Ручний тест реакції на пост через сторінку автора ===");
    logStep("Параметри", { profileNo, postUrl, browserMode: "visible" });

    try {
        logStep("Отримуємо профіль AdsPower");
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) throw new Error(`Профіль ${profileNo} не знайдено`);

        logStep("Перевіряємо готовність профілю");
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        logStep("Відкриваємо профіль у видимому режимі");
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });

        logStep("Відкриваємо Facebook");
        await openPageWithoutPopups(page, "https://www.facebook.com/");

        logStep("Перевіряємо авторизацію");
        if (!await ensureFacebookAccountLoggedIn(adsPower, profile, page)) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        logStep("Перевіряємо активність акаунта");
        if (!await ensureFacebookAccountActive(adsPower, profile, page)) {
            throw new Error("Facebook-акаунт неактивний");
        }

        logStep("Перемикаємо Facebook на англійську");
        if (!await ensureEnglish(page)) {
            throw new Error("Не вдалося встановити англійську мову");
        }

        logStep("Відкриваємо пост через сторінку автора");
        const postResult = await openFacebookPostViaAuthorPage(page, {
            postUrl,
            logger: console,
        });
        console.dir(postResult, { depth: null });
        if (!postResult.success) {
            throw new Error(`Пост не відкрито: ${postResult.status}`);
        }

        logStep("Пост відкрито", {
            currentUrl: page.url(),
            openedPostId: postResult.openedPostId,
        });

        logStep("Перевіряємо кнопки реакцій", {
            selector: reactionButtonSelector,
        });
        console.dir(
            await inspectReactionButtons(page, reactionButtonSelector),
            { depth: null }
        );

        const reaction = postReactions[randomInteger(0, postReactions.length - 1)];
        logStep("Ставимо випадкову реакцію під постом", { reaction });
        const reactionResult = await setPostReaction(page, reaction);
        logStep("Результат реакції", { reaction, applied: reactionResult });

        logStep("Повторно перевіряємо кнопки реакцій");
        console.dir(
            await inspectReactionButtons(page, reactionButtonSelector),
            { depth: null }
        );

        await waitForExit();
    } catch (error) {
        console.error("[POST-REACTION] ПОМИЛКА:", error.stack ?? error.message);
        process.exitCode = 1;
        if (browser) await waitForExit();
    } finally {
        browser?.disconnect();
        if (profileOpened) {
            console.log(`[POST-REACTION] Профіль ${profileNo} залишено відкритим.`);
        }
    }
}


main();
