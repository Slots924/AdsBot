import { modalDialogSelector } from "./overlays.js";


/** Кнопка камери для зміни аватарки особистого профілю. */
export const updateProfilePictureButtonSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Update profile picture"]';

/** Клікабельна аватарка, яка відкриває меню дій, коли кнопки камери немає. */
export const profilePictureActionsButtonSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Profile picture actions"]';

/** Пункт вибору аватарки в меню дій поточного зображення. */
export const chooseProfilePictureMenuItemSelector =
    'div[role="menu"] [role="menuitem"]';

/** Діалог вибору або попереднього перегляду аватарки. */
export const chooseProfilePictureDialogSelector =
    `${modalDialogSelector}[aria-label="Choose profile picture"]`;

/** Кнопка завантаження нового фото в діалозі вибору аватарки. */
export const uploadProfilePhotoButtonSelector =
    `${chooseProfilePictureDialogSelector} `
    + 'div[role="button"][aria-label="Upload photo" i]';

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

/** Основне зображення поточних шпалер особистого профілю. */
export const coverPhotoImageSelector =
    'div[role="main"] '
    + 'a[role="link"][aria-label="View profile cover photo" i] img';

/** Кнопка відкриття меню редагування шпалер особистого профілю. */
export const editCoverPhotoButtonSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Edit cover photo" i]';

/** Меню з доступними способами редагування шпалер профілю. */
export const coverPhotoEditingMenuSelector =
    'div[role="menu"][aria-label="Cover photo editing options" i]';

/** Пункти меню редагування шпалер; потрібний пункт уточнюється за текстом. */
export const coverPhotoEditingMenuItemSelector =
    `${coverPhotoEditingMenuSelector} [role="menuitem"]`;

/** Image-only file input, який Facebook створює для завантаження шпалер. */
export const coverPhotoUploadInputSelector =
    'input[type="file"][accept="image/*,image/heif,image/heic"]';

/** Кнопка збереження нових шпалер після preview та reposition. */
export const saveCoverPhotoButtonSelector =
    'div[role="main"] '
    + 'div[role="button"][aria-label="Save changes" i]';
