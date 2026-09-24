/** Поточна кнопка реакції під відкритим Facebook-постом. */
export const reactionButtonSelector =
    'div[role="dialog"][aria-modal="true"][aria-labelledby] '
    + '[role="button"][aria-label="Like" i], '
    + 'div[role="dialog"][aria-modal="true"][aria-labelledby] '
    + '[role="button"][aria-label^="Remove " i]';

/** Панель із доступними реакціями Facebook. */
export const reactionsToolbarSelector =
    'div[data-visualcompletion="ignore-dynamic"]'
    + '[aria-label="Reactions" i][role="dialog"] [role="toolbar"]';

/** Створює селектор конкретної реакції всередині панелі реакцій. */
export function getReactionOptionSelector(reactionName) {
    return `${reactionsToolbarSelector} [aria-label="${reactionName}" i]`;
}
