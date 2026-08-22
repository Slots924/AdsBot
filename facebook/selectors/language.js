/** Поточна мова в кореневому HTML-елементі Facebook. */
export const facebookLanguageSelector =
    'html[id="facebook"][lang]';

/** Кнопка відкриття налаштування мови Facebook. */
export const languageSettingsButtonSelector =
    'div[role="main"] div[style^="border-radius"] '
    + 'div[class^="html-div"] div[role="button"]';

/** Модальне вікно вибору мови. */
export const languageDialogSelector =
    'div[aria-labelledby][role="dialog"]';

/** Поле пошуку мови в модальному вікні. */
export const languageSearchInputSelector =
    `${languageDialogSelector} input[placeholder][type="text"]`;

/** Перший результат пошуку мови в модальному вікні. */
export const firstLanguageResultSelector =
    `${languageDialogSelector} `
    + 'div[data-visualcompletion="ignore-dynamic"] > div:nth-of-type(1)';
