import { modalDialogSelector } from "./overlays.js";


/** Кнопка керування дописами на сторінці особистого профілю. */
export const personalProfileManagePostsButtonSelector =
    'div[role="main"] [role="button"][aria-label="Manage posts" i]';

/** Діалог масового керування дописами особистого профілю. */
export const personalProfileManagePostsDialogSelector =
    `${modalDialogSelector}[aria-label="Manage posts" i]`;

/** Усі кнопки діалогу; текстові дії уточнюються після нормалізації тексту. */
export const personalProfileManagePostsButtonCandidatesSelector =
    `${personalProfileManagePostsDialogSelector} [role="button"]`;

/** Чекбокси карток дописів у діалозі керування. */
export const personalProfileManagePostsCheckboxSelector =
    `${personalProfileManagePostsDialogSelector} `
    + 'input[type="checkbox"][aria-label="Add" i]';

/** Перехід від вибору дописів до вибору масової дії. */
export const personalProfileManagePostsNextButtonSelector =
    `${personalProfileManagePostsDialogSelector} `
    + '[role="button"][aria-label="Next" i]';

/** Радіокнопки дій; доступне ім’я читається через aria-labelledby. */
export const personalProfileManagePostsActionRadioSelector =
    `${personalProfileManagePostsDialogSelector} [role="radio"]`;

/** Підтвердження вибраної масової дії. */
export const personalProfileManagePostsDoneButtonSelector =
    `${personalProfileManagePostsDialogSelector} `
    + '[role="button"][aria-label="Done" i]';

/** Закриття діалогу Manage posts перед повторним відкриттям із початку. */
export const personalProfileManagePostsCloseButtonSelector =
    `${personalProfileManagePostsDialogSelector} `
    + '[role="button"][aria-label="Close" i]';

/** Кнопки можливого додаткового діалогу підтвердження видалення. */
export const personalProfileDeleteConfirmationButtonCandidatesSelector =
    `${modalDialogSelector} [role="button"]`;
