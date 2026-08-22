import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import {
    facebookLanguageSelector,
    firstLanguageResultSelector,
    languageDialogSelector,
    languageSearchInputSelector,
    languageSettingsButtonSelector,
} from "../selectors/language.js";


async function humanClick(page, selector) {
    const element = await waitForVisibleElement(page, selector, {
        timeout: 30000,
    });

    try {
        await humanClickElement(page, element, {
            beforeDelay: [60, 140],
            holdDelay: [70, 160],
        });
    } finally {
        await element.dispose();
    }
}


async function ensureEnglish(page) {
    try {
        await page.goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
        });

        await waitHuman("short");

        const language = await page.$eval(
            facebookLanguageSelector,
            (element) => element.getAttribute("lang")
        );

        if (language === "en") {
            return;
        }

        await page.goto(
            "https://www.facebook.com/settings/?tab=language",
            {
                waitUntil: "domcontentloaded",
            }
        );

        await waitHuman("extraLong");

        await humanClick(
            page,
            languageSettingsButtonSelector
        );

        await waitHuman("extraLong");

        const dialog = await waitForVisibleElement(
            page,
            languageDialogSelector,
            { timeout: 30000 }
        );
        await dialog.dispose();

        const input = await waitForVisibleElement(
            page,
            languageSearchInputSelector,
            { timeout: 30000 }
        );
        await input.dispose();

        await page.type(languageSearchInputSelector, "US", {
            delay: 300,
        });

        await waitHuman("medium");

        await humanClick(
            page,
            firstLanguageResultSelector
        );

        await waitHuman("extraLong");
    } catch {
        // Зміна мови не повинна зупиняти подальшу роботу програми
    }
}


export default ensureEnglish;
