export const loggedOutLabels = [
    {
        continueText: "Continue",
        useAnotherProfile: ["Use another profile"],
        createNewAccount: ["Create new account"],
    },
    {
        continueText: "Weiter",
        useAnotherProfile: ["Anderes Profil verwenden"],
        createNewAccount: ["Neues Konto erstellen"],
    },
    {
        continueText: "Continuer",
        useAnotherProfile: ["Utiliser un autre profil"],
        createNewAccount: ["Créer un nouveau compte"],
    },
    {
        continueText: "Continuar",
        useAnotherProfile: ["Usar otro perfil"],
        createNewAccount: ["Crear cuenta nueva", "Crear una cuenta nueva"],
    },
    {
        continueText: "Продовжити",
        useAnotherProfile: ["Використати інший профіль"],
        createNewAccount: ["Створити новий обліковий запис"],
    },
    {
        continueText: "Продолжить",
        useAnotherProfile: ["Использовать другой профиль"],
        createNewAccount: ["Создать новый аккаунт"],
    },
    {
        continueText: "जारी रखें",
        useAnotherProfile: ["किसी अन्य प्रोफ़ाइल का उपयोग करें"],
        createNewAccount: ["नया अकाउंट बनाएँ", "नया खाता बनाएँ"],
    },
    {
        continueText: "devam et",
        useAnotherProfile: ["Başka bir profil kullan"],
        createNewAccount: ["Yeni hesap oluştur"],
    },
];


async function isLoggedOut(page) {
    return page.evaluate((labelsByLanguage) => {
        const ariaLabels = Array.from(
            document.querySelectorAll("[aria-label]")
        ).map((element) => element.getAttribute("aria-label")?.trim());

        return labelsByLanguage.some((labels) => {
            const hasContinue = ariaLabels.some((ariaLabel) =>
                ariaLabel
                    ?.toLocaleLowerCase()
                    .includes(labels.continueText.toLocaleLowerCase())
            );
            const hasUseAnotherProfile = labels.useAnotherProfile.some(
                (label) => ariaLabels.includes(label)
            );
            const hasCreateNewAccount = labels.createNewAccount.some(
                (label) => ariaLabels.includes(label)
            );

            return hasContinue
                && hasUseAnotherProfile
                && hasCreateNewAccount;
        });
    }, loggedOutLabels);
}


async function isLoginRequired(page) {
    return page.evaluate(() => {
        const emailInput = document.querySelector(
            '[dir="ltr"][autocomplete="username webauthn"]'
            + '[type="text"][name="email"]'
        );
        const passwordInput = document.querySelector(
            '[dir="ltr"][aria-invalid="false"]'
            + '[type="password"][name="pass"]'
        );

        return Boolean(emailInput && passwordInput);
    });
}


async function detectLoginStatus(page) {
    if (await isLoggedOut(page)) {
        console.log("Акаунт Facebook має статус LOGGED_OUT");
        return "LOGGED_OUT";
    }

    if (await isLoginRequired(page)) {
        console.log("Акаунт Facebook має статус LOGIN_REQUIRED");
        return "LOGIN_REQUIRED";
    }

    console.log("Акаунт Facebook має статус LOGGED_IN");
    return "LOGGED_IN";
}


export default detectLoginStatus;
