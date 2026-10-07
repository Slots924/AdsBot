import { getFacebookTexts } from "../i18n/index.js";
import ariaLabelSelector from "./ariaLabel.js";


export const createNewAccountLabels = getFacebookTexts("login.createAccount");


export const useAnotherProfileLabels = getFacebookTexts("login.useAnotherProfile");


export const logInLabels = getFacebookTexts("login.logIn");


/** Посилання «створити новий акаунт» на сторінці входу. */
export const createNewAccountSelector = ariaLabelSelector(
    "a",
    createNewAccountLabels
);


/** Кнопка вибору іншого профілю, коли Facebook показує кілька акаунтів. */
export const useAnotherProfileSelector = ariaLabelSelector(
    '[role="button"]',
    useAnotherProfileLabels
);


/** Кнопка входу після появи форми логіна і пароля. */
export const logInButtonSelector = ariaLabelSelector(
    '[role="button"]',
    logInLabels
);
