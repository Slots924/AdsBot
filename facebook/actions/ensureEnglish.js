import { waitForVisibleElement } from "../browser/elements.js";
import { clickModalSelector } from "../modals/clickModalControl.js";
import { waitHuman } from "../browser/timing.js";
import {
    facebookLanguageSelector,
    firstLanguageResultSelector,
    languageDialogSelector,
    languageSearchInputSelector,
    languageSettingsButtonSelector,
} from "../selectors/language.js";
async function ensureEnglish(page) {
    try {
        const language = await page.$eval(
            facebookLanguageSelector,
            (element) => element.getAttribute("lang")
        );

        if (language === "en") {
            return true;
        }

        await page.goto(
            "https://www.facebook.com/settings/?tab=language",
            {
                waitUntil: "domcontentloaded",
            }
        );

        await clickModalSelector(
            page,
            languageSettingsButtonSelector,
            30000,
            undefined,
            "medium"
        );

        await waitHuman("short");

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

        await clickModalSelector(
            page,
            firstLanguageResultSelector,
            30000,
            undefined,
            "medium"
        );

        await waitHuman("short");
        return true;
    } catch {
        // Зміна мови не повинна зупиняти подальшу роботу програми
        return false;
    }
}


export default ensureEnglish;
