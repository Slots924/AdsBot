/** Поточна кнопка реакції під відкритим Facebook-постом. */
export const reactionButtonSelector =
    'div[role="dialog"][aria-modal="true"][aria-labelledby] '
    + 'div[data-visualcompletion="ignore-dynamic"] [aria-label]';

/** Панель із доступними реакціями Facebook. */
export const reactionsToolbarSelector =
    'div[data-visualcompletion="ignore-dynamic"]'
    + '[aria-label="Reactions"][role="dialog"] [role="toolbar"]';

/** Створює селектор конкретної реакції всередині панелі реакцій. */
export function getReactionOptionSelector(reactionName) {
    return `${reactionsToolbarSelector} [aria-label="${reactionName}"]`;
}
