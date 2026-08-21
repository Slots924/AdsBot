import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import dismissAutomatedBehavior from "../../facebook/actions/dismissAutomatedBehavior.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import isAutomatedBehavior from "../../facebook/state/checks/isAutomatedBehavior.js";
import isProfileOpen from "../../services/profile/isProfileOpen.js";


const profileNo = 1418;
const facebookUrl = "https://www.facebook.com/";


async function testDetectFacebookState() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpenedByTest = false;

    console.log("=== Початок тесту detectFacebookState ===");
    console.log(`Профіль AdsPower: ${profileNo}`);

    try {
        console.log("Крок 1. Отримуємо інформацію про профіль...");
        const profile = await adsPower.getProfileByNo(profileNo);
        console.log("Профіль успішно отримано");

        console.log("Крок 2. Перевіряємо, чи профіль уже відкритий...");
        const profileAlreadyOpen = await isProfileOpen(
            adsPower,
            profile
        );

        if (profileAlreadyOpen) {
            console.log(
                "Профіль уже відкритий або його статус не вдалося перевірити"
            );
            console.log("Тест зупинено, щоб не запускати профіль повторно");
            return;
        }

        console.log("Профіль зараз не відкритий");
        console.log("Крок 3. Відкриваємо профіль через AdsPower...");

        const browserData = await adsPower.openProfile(profileNo);
        profileOpenedByTest = true;
        console.log("Профіль успішно відкрито");

        console.log("Крок 4. Підключаємо Puppeteer до браузера...");
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        console.log("Puppeteer успішно підключено");

        console.log("Крок 5. Отримуємо сторінку браузера...");
        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        console.log(`Сторінку отримано. Поточний URL: ${page.url()}`);

        console.log("Крок 6. Відкриваємо Facebook...");
        await openPageWithoutPopups(page, facebookUrl);
        console.log(`Facebook відкрито. Поточний URL: ${page.url()}`);

        console.log("Крок 7. Визначаємо стан Facebook...");
        const facebookState = await detectFacebookState(page);

        console.log(`Результат detectFacebookState: ${facebookState}`);

        if (facebookState === "AUTOMATED_BEHAVIOR") {
            console.log(
                "Виявлено попередження про автоматизовану поведінку"
            );

            console.log(
                "Крок 8. Викликаємо action dismissAutomatedBehavior..."
            );
            const dismissResult = await dismissAutomatedBehavior(page);
            console.log(
                `Результат dismissAutomatedBehavior: ${dismissResult}`
            );

            console.log(
                "Крок 9. Повторно перевіряємо automated behavior..."
            );
            const automatedBehaviorStillPresent =
                await isAutomatedBehavior(page);

            console.log(
                `Результат isAutomatedBehavior після Dismiss: ${automatedBehaviorStillPresent}`
            );

            if (automatedBehaviorStillPresent) {
                throw new Error(
                    "Плашка automated behavior не зникла після натискання Dismiss"
                );
            }

            console.log(
                "Плашка automated behavior успішно закрита"
            );
        } else if (facebookState === "BANNED") {
            console.log("Facebook-акаунт заблокований");
        } else if (facebookState === "NOTICE") {
            console.log("Facebook показує інформаційне повідомлення");
        } else if (facebookState === "READY") {
            console.log("Facebook-акаунт готовий до роботи");
        } else {
            console.log("Стан Facebook не вдалося визначити");
        }

        console.log("Тест detectFacebookState успішно завершено");
    } catch (error) {
        console.error("Помилка тесту detectFacebookState:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        if (browser) {
            console.log("Відключаємо Puppeteer від браузера...");
            browser.disconnect();
            console.log(
                "Puppeteer відключено, але браузер залишається відкритим"
            );
        }

        if (profileOpenedByTest) {
            console.log(
                `Профіль ${profileNo} залишено відкритим для подальшої відладки`
            );
        } else {
            console.log("Тест не відкривав профіль");
        }

        console.log("=== Завершення тесту detectFacebookState ===");
    }
}


testDetectFacebookState();
