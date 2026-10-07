import { getFacebookTexts } from "../i18n/index.js";
import { createNewAccountLabels } from "./login.js";

export const accountRecovery = Object.freeze({
    controls: '[role="button"], button, input[type="submit"]',
    dialog: '[role="dialog"]',
    protectionTexts: getFacebookTexts("recovery.protection"),
    labels: {
        start: getFacebookTexts("recovery.start"),
        email: getFacebookTexts("recovery.email"),
        phone: getFacebookTexts("recovery.phone"),
        whatsapp: getFacebookTexts("recovery.whatsapp"),
        next: getFacebookTexts("recovery.next"),
        save: getFacebookTexts("recovery.save"),
        back: getFacebookTexts("recovery.back"),
    },
    headings: {
        recoveryMethod: getFacebookTexts("recovery.recoveryMethod"),
        code: getFacebookTexts("recovery.code"),
        newPassword: getFacebookTexts("recovery.newPassword"),
        currentPassword: getFacebookTexts("recovery.currentPassword"),
    },
    recoveryMethods: ["email", "phone", "whatsapp"],
    codeErrors: getFacebookTexts("recovery.codeErrors"),
    passwordErrors: getFacebookTexts("recovery.passwordErrors"),
    authenticated: '[role="button"][aria-label]',
    authenticatedLabels: getFacebookTexts("account.profileButton"),
    login: 'input[autocomplete="username"], input[name="email"]',
    loginLink: 'a[aria-label]',
    loginLabels: createNewAccountLabels,
});
