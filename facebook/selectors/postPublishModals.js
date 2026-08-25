/** Модальне вікно після кнопки Post. */
export const postPublishModalDialogSelector =
    'div[role="dialog"][aria-modal="true"]';

/** Заголовок модалки. */
export const postPublishModalTitleSelector =
    'h2 span[dir="auto"], h2, [role="heading"]';

/** Кнопка Continue у Review audience. */
export const postPublishContinueButtonSelector =
    'div[role="button"][aria-label="Continue" i]';

/** Напис Public у модалці; клікаємо parent цього span. */
export const postPublishPublicLabelSelector =
    'div[role="dialog"] span[dir="auto"]';

/** Кнопка Save вибору аудиторії. */
export const postPublishAudienceSaveButtonSelector =
    '[aria-label="Save privacy audience selection and close dialog" i]';

export const postPublishModalSelectors = Object.freeze({
    dialog: postPublishModalDialogSelector,
    title: postPublishModalTitleSelector,
    continueButton: postPublishContinueButtonSelector,
    publicLabel: postPublishPublicLabelSelector,
    saveButton: postPublishAudienceSaveButtonSelector,
});
