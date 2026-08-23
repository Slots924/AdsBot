/** Посилання на таймлайн, з якого динамічно визначається ім’я профілю. */
export const personalProfileTimelineLinkSelector =
    'div[role="main"] a[role="link"][aria-label$="\'s Timeline" i], '
    + 'div[role="main"] a[role="link"][aria-label$="’s Timeline" i]';

/** Кандидати на клікабельне ім’я у шапці особистого профілю. */
export const personalProfileNameButtonCandidatesSelector =
    'div[role="main"] div[role="button"][tabindex="0"]';

/** Ознаки сусідніх дій, які відрізняють шапку профілю від постів. */
export const personalProfileHeaderActionSelector =
    '[aria-label="Add to story" i], [aria-label="Edit profile" i]';

/** Модальні діалоги Facebook, серед яких уточнюється інформаційний діалог профілю. */
export const personalProfileInformationDialogSelector =
    'div[role="dialog"][aria-modal="true"]';

/** Кнопка закриття всередині інформаційного діалогу профілю. */
export const personalProfileInformationCloseButtonSelector =
    '[role="button"][aria-label="Close" i]';
