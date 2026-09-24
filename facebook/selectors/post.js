/** Модальне вікно відкритого Facebook-поста. */
export const postDialogSelector =
    'div[role="dialog"][aria-modal="true"][aria-labelledby]';

/** Основна область контенту відкритого Facebook-поста. */
export const availablePostSelector =
    postDialogSelector;

/** Кнопка реакції відкритого Facebook-поста, до якої прокручуємо перед взаємодією. */
export const postLikeAreaSelector =
    `${postDialogSelector} [role="button"][aria-label="Like" i], `
    + `${postDialogSelector} [role="button"][aria-label^="Remove " i]`;

/** Коментарі верхнього рівня у відкритому Facebook-пості. */
export const topLevelCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Comment by " i]';

/** Відповіді на коментарі у відкритому Facebook-пості. */
export const replyCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Reply by " i]';

/** Усі коментарі та відповіді у відкритому Facebook-пості. */
export const allPostCommentSelector =
    `${topLevelCommentSelector}, ${replyCommentSelector}`;

/** Коментарі та відповіді у звичайному вбудованому пості Facebook. */
export const allEmbeddedPostCommentSelector =
    '[role="article"][aria-label^="Comment by " i], '
    + '[role="article"][aria-label^="Reply by " i]';

/** Елемент із текстом поста, від якого можна знайти корінь вбудованого поста. */
export const storyMessageSelector =
    '[data-ad-rendering-role="story_message"]';

/** Кнопки, доступні всередині модального вікна поста. */
export const commentButtonSelector =
    `${postDialogSelector} [role="button"]`;

/** Поле введення відповіді на конкретний коментар. */
export const replyInputSelector =
    '[contenteditable="true"][role="textbox"]'
    + '[aria-label^="Reply to " i]';

/** Поле введення нового коментаря під постом. */
export const commentInputSelector =
    '[role="dialog"] [role="textbox"][contenteditable="true"]'
    + '[data-lexical-editor="true"]';

/** Кнопка поточного порядку сортування коментарів. */
export const commentOrderingButtonSelector =
    `${postDialogSelector} `
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span), '
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span)';

/** Меню вибору порядку сортування коментарів. */
export const commentOrderingMenuSelector =
    '[aria-label="Comment Ordering" i][role="menu"]';

/** Окремий пункт меню сортування коментарів. */
export const commentOrderingMenuItemSelector =
    '[role="menuitem"]';
