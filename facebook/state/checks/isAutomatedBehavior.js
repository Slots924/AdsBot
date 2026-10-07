import { getFacebookTexts } from "../../i18n/index.js";

export const automatedBehaviorTexts = getFacebookTexts("automatedBehavior.warning");


export default async function isAutomatedBehavior(page) {
    const currentUrl = page.url();

    if (!currentUrl.includes("www.facebook.com/checkpoint")) {
        return false;
    }

    return page.evaluate((textsByLanguage) => {
        const normalizeText = (text) => String(text ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase()
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .replace(/ı/g, "i");

        return Array.from(
            document.querySelectorAll("span")
        ).some((span) => {
            const spanText = normalizeText(span.textContent);

            return textsByLanguage.some((text) =>
                spanText.includes(normalizeText(text))
            );
        });
    }, automatedBehaviorTexts);
}
