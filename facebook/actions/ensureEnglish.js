import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";


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
            'html[id="facebook"][lang]',
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
            'div[role="main"] div[style^="border-radius"] div[class^="html-div"] div[role="button"]'
        );

        await waitHuman("extraLong");

        const dialogSelector =
            'div[aria-labelledby][role="dialog"]';

        const dialog = await waitForVisibleElement(
            page,
            dialogSelector,
            { timeout: 30000 }
        );
        await dialog.dispose();

        const inputSelector =
            `${dialogSelector} input[placeholder][type="text"]`;

        const input = await waitForVisibleElement(
            page,
            inputSelector,
            { timeout: 30000 }
        );
        await input.dispose();

        await page.type(inputSelector, "US", {
            delay: 300,
        });

        await waitHuman("medium");

        await humanClick(
            page,
            `${dialogSelector} div[data-visualcompletion="ignore-dynamic"] > div:nth-of-type(1)`
        );

        await waitHuman("extraLong");
    } catch {
        // Зміна мови не повинна зупиняти подальшу роботу програми
    }
}


export default ensureEnglish;
