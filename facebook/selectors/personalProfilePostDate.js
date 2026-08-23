import { postDialogSelector } from "./post.js";


/** Кнопка меню дій у модальному вікні особистого поста. */
export const personalProfilePostActionsButtonSelector =
    `${postDialogSelector} `
    + '[role="button"][aria-haspopup="menu"]'
    + '[aria-label^="Actions for this post by " i]';

/** Видимі пункти меню дій поста; потрібний пункт звіряється за текстом. */
export const personalProfilePostMenuItemSelector =
    '[role="menu"] [role="menuitem"]';

/** Модальні діалоги, серед яких за доступним заголовком шукається Edit Date. */
export const personalProfileEditDateDialogSelector =
    'div[role="dialog"][aria-modal="true"][aria-labelledby]';

/** Поля дати й часу в діалозі Edit Date. */
export const personalProfileEditDateComboboxSelector =
    'input[role="combobox"][type="text"]';

/** Кнопка збереження нової дати. */
export const personalProfileEditDateDoneButtonSelector =
    '[role="button"][aria-label="Done" i]';

/** Кнопка скасування зміни дати. */
export const personalProfileEditDateCancelButtonSelector =
    '[role="button"][aria-label="Cancel editing timeline date" i]';

/** Кнопка закриття модального вікна поста. */
export const personalProfilePostCloseButtonSelector =
    '[role="button"][aria-label="Close" i]';
