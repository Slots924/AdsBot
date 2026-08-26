/** Картка поста у стрічці особистого профілю за позицією. */
export function getPersonalProfileFeedPostSelector(posinset) {
    return `[aria-posinset="${posinset}"]`;
}

/** Три крапки меню дій конкретного поста. */
export function getPersonalProfileFeedPostActionsButtonSelector(posinset) {
    return `${getPersonalProfileFeedPostSelector(posinset)} `
        + '[role="button"][aria-haspopup="menu"]'
        + '[aria-label^="Actions for this post by" i]';
}

/** Пункти випадаючого меню поста. */
export const personalProfileFeedPostMenuItemSelector =
    '[role="menu"] [role="menuitem"]';

/** Кнопки, серед яких шукаємо Hide from profile. */
export const personalProfileFeedPostActionButtonSelector = '[role="button"]';

/** Кнопка Move у вікні підтвердження перенесення в кошик. */
export const personalProfileMoveToTrashButtonSelector =
    '[role="dialog"][aria-label="Move to your trash?" i] '
    + '[role="button"][aria-label="Move" i]';
