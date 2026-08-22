import { modalDialogSelector } from "./overlays.js";


/** Кнопка камери для зміни аватарки особистого профілю. */
export const updateProfilePictureButtonSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Update profile picture"]';

/** Діалог вибору або попереднього перегляду аватарки. */
export const chooseProfilePictureDialogSelector =
    `${modalDialogSelector}[aria-label="Choose profile picture"]`;

/** Кнопка завантаження нового фото в діалозі вибору аватарки. */
export const uploadProfilePhotoButtonSelector =
    `${chooseProfilePictureDialogSelector} `
    + 'div[role="button"][aria-label="Upload Photo"]';

/** File input для зображення всередині діалогу вибору аватарки. */
export const profilePictureUploadInputSelector =
    `${chooseProfilePictureDialogSelector} `
    + 'input[type="file"]'
    + '[accept="image/*,image/heif,image/heic"]';

/** Кнопка збереження у preview нової аватарки. */
export const saveProfilePictureButtonSelector =
    `${chooseProfilePictureDialogSelector} `
    + 'div[role="button"][aria-label="Save"]';

/** Основне SVG-зображення поточної аватарки профілю. */
export const profilePictureImageSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Profile picture actions"] image';
