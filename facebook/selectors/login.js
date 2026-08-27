function ariaLabelSelector(base, labels) {
    return labels
        .map((label) => `${base}[aria-label="${label}" i]`)
        .join(", ");
}


export const createNewAccountLabels = [
    "Create new account",
    "Neues Konto erstellen",
    "Créer un nouveau compte",
    "Crear cuenta nueva",
    "Crear una cuenta nueva",
    "Створити новий обліковий запис",
    "Создать новый аккаунт",
    "नया अकाउंट बनाएँ",
    "नया खाता बनाएँ",
    "Yeni hesap oluştur",
];


export const useAnotherProfileLabels = [
    "Use another profile",
    "Anderes Profil verwenden",
    "Utiliser un autre profil",
    "Usar otro perfil",
    "Використати інший профіль",
    "Использовать другой профиль",
    "किसी अन्य प्रोफ़ाइल का उपयोग करें",
    "Başka bir profil kullan",
];


export const logInLabels = [
    "Log In",
    "Anmelden",
    "Se connecter",
    "Iniciar sesión",
    "Увійти",
    "Войти",
    "लॉग इन करें",
    "Giriş yap",
];


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
