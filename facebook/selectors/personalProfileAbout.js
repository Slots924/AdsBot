/** Горизонтальна панель вкладок особистого профілю. */
export const personalProfileAboutProfileTablistSelector =
    '[role="tablist"][aria-orientation="horizontal"]';

/** Вкладка About на особистій сторінці. */
export const personalProfileAboutTabSelector =
    `${personalProfileAboutProfileTablistSelector} `
    + 'a[role="tab"][href*="sk=about"]';

/** Бічна панель розділів About. */
export const personalProfileAboutPanelSelector =
    '[role="tablist"]:has(a[role="tab"][href*="sk=directory_intro"])';

/** Вкладка Intro у бічній панелі About. */
export const personalProfileAboutIntroTabSelector =
    `${personalProfileAboutPanelSelector} `
    + 'a[role="tab"][href*="sk=directory_intro"]';

/** Вкладка Work у бічній панелі About. */
export const personalProfileAboutWorkTabSelector =
    `${personalProfileAboutPanelSelector} `
    + 'a[role="tab"][href*="sk=directory_work"]';

/** Вкладка Education у бічній панелі About. */
export const personalProfileAboutEducationTabSelector =
    `${personalProfileAboutPanelSelector} `
    + 'a[role="tab"][href*="sk=directory_education"]';

/** Кнопка редагування вже збереженого біо. */
export const personalProfileAboutEditBioButtonSelector =
    '[role="button"][aria-label="Edit bio" i]';

/** Кнопка збереження форми About. */
export const personalProfileAboutSaveButtonSelector =
    '[role="button"][aria-label="Save" i]';

/** Кнопка редагування вже доданого місця роботи. */
export const personalProfileAboutEditWorkplaceButtonSelector =
    '[role="button"][aria-label="Edit Workplace" i]';

/** Combobox назви компанії. */
export const personalProfileAboutCompanyComboboxSelector =
    'input[role="combobox"][aria-label="Company" i]';

/** Поле посади. */
export const personalProfileAboutPositionInputSelector =
    'input[aria-label="Position" i]';

/** Кнопка редагування вже доданого коледжу. */
export const personalProfileAboutEditCollegeButtonSelector =
    '[role="button"][aria-label="Edit college" i]';

/** Combobox назви коледжу. */
export const personalProfileAboutCollegeNameComboboxSelector =
    'input[role="combobox"][aria-label="College name" i]';

/** Рядки випадаючого списку combobox. */
export const personalProfileAboutComboboxOptionSelector =
    'li[role="option"]';

/** Будь-яке модальне вікно Facebook. */
export const personalProfileAboutModalDialogSelector =
    '[role="dialog"][aria-modal="true"]';

/** Модальне вікно Invalid Name після Save у About. */
export const personalProfileAboutInvalidNameDialogSelector =
    'div[role="dialog"][aria-modal="true"]';

/** Кнопка OK у вікні Invalid Name. */
export const personalProfileAboutInvalidNameOkButtonSelector =
    'div[role="button"][aria-label="OK" i]';

/** Попередження про незбережені зміни. */
export const personalProfileAboutLeavePageDialogSelector =
    '[role="dialog"][aria-modal="true"][aria-label="Leave Page?" i]';

/** Активна кнопка виходу зі сторінки без збереження. */
export const personalProfileAboutLeavePageButtonSelector =
    '[role="button"][aria-label="Leave Page" i][tabindex="0"]';

/** Кнопка закриття модального вікна. */
export const personalProfileAboutDialogCloseButtonSelector =
    '[role="button"][aria-label="Close" i]';

/** Кнопка OK у діалозі помилки. */
export const personalProfileAboutDialogOkButtonSelector =
    '[role="button"][aria-label="OK" i]';

export const personalProfileAboutSelectors = Object.freeze({
    profileTablist: personalProfileAboutProfileTablistSelector,
    aboutTab: personalProfileAboutTabSelector,
    aboutPanel: personalProfileAboutPanelSelector,
    introTab: personalProfileAboutIntroTabSelector,
    workTab: personalProfileAboutWorkTabSelector,
    educationTab: personalProfileAboutEducationTabSelector,
    editBio: personalProfileAboutEditBioButtonSelector,
    save: personalProfileAboutSaveButtonSelector,
    editWorkplace: personalProfileAboutEditWorkplaceButtonSelector,
    company: personalProfileAboutCompanyComboboxSelector,
    position: personalProfileAboutPositionInputSelector,
    editCollege: personalProfileAboutEditCollegeButtonSelector,
    collegeName: personalProfileAboutCollegeNameComboboxSelector,
    comboboxOption: personalProfileAboutComboboxOptionSelector,
    modalDialog: personalProfileAboutModalDialogSelector,
    invalidNameDialog: personalProfileAboutInvalidNameDialogSelector,
    invalidNameOk: personalProfileAboutInvalidNameOkButtonSelector,
    leavePageDialog: personalProfileAboutLeavePageDialogSelector,
    leavePageButton: personalProfileAboutLeavePageButtonSelector,
    dialogClose: personalProfileAboutDialogCloseButtonSelector,
    dialogOk: personalProfileAboutDialogOkButtonSelector,
});
