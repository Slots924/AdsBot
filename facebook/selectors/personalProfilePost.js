import { modalDialogSelector } from "./overlays.js";


/** Видимі кнопки головної області, серед яких текстом знаходиться composer. */
export const personalProfileComposerButtonCandidatesSelector =
    'div[role="main"] div[role="button"]';

/** Діалог створення допису в особистому профілі. */
export const personalProfileCreatePostDialogSelector =
    `${modalDialogSelector}[aria-label="Create post" i]`;

/** Кнопка поточної аудиторії допису. */
export const personalProfilePostPrivacyButtonSelector =
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label^="Edit privacy." i]';

/** Radio-варіанти аудиторії; потрібний варіант визначається за текстом рядка. */
export const personalProfileAudienceRadioSelector =
    `${personalProfileCreatePostDialogSelector} input[type="radio"]`;

/** Підтвердження вибору аудиторії. */
export const personalProfileAudienceDoneButtonSelector =
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"]'
    + '[aria-label="Done with privacy audience selection and close dialog" i]';

/** Кнопка, яка відкриває системний chooser фотографій і відео. */
export const personalProfilePhotoVideoButtonSelector =
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label="Photo/video" i]';

/** Кнопка остаточної публікації допису. */
export const personalProfilePublishPostButtonSelector =
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label="Post" i]';
