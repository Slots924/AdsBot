/** Елементи Accounts Center, які використовуються під час зміни імені. */
export const facebookNameChangeSelectors = {
    /** Посилання для відкриття огляду акаунтів. */
    accountOverview: 'a[href*="account_overview"]',
    /** Модальне вікно огляду акаунтів. */
    accountOverviewDialog:
        'div[role="dialog"][aria-modal="true"]',
    /** Посилання на Facebook-профіль у вікні огляду акаунтів. */
    accountOverviewDialogLink:
        'div[role="dialog"][aria-modal="true"] '
        + 'a[role="link"][href*="entrypoint=account_overview"]',
    /** Особистий Facebook-профіль у списку Accounts Center. */
    profile:
        'div[role="list"] [role="listitem"] [aria-label] '
        + '[aria-hidden="true"][role="presentation"]',
    /** Видимий вміст модального вікна вибраного профілю. */
    profileDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby] '
        + '[aria-hidden="false"]',
    /** Посилання на налаштування імені профілю. */
    nameLink: 'a[role="link"][aria-label="Name"]',
    /** Видимий вміст форми редагування імені. */
    nameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"] '
        + '[aria-hidden="false"]',
    /** Будь-яке модальне вікно налаштування імені. */
    anyNameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"]',
    /** Модальне вікно результату зі зв’язаним заголовком. */
    anyDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby]',
    /** Усі модальні вікна для читання повідомлень про блокування. */
    visibleDialogs:
        'div[role="dialog"][aria-modal="true"]',
    /** Ім’я профілю, показане після завершення зміни. */
    finalName: 'h3[dir="auto"] > span',
};
