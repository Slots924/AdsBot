/** Модальне вікно відкритого Facebook-поста. */
export const postDialogSelector =
    'div[role="dialog"][aria-modal="true"][aria-labelledby]';

/** Основна область контенту відкритого Facebook-поста. */
export const availablePostSelector =
    postDialogSelector;

/** Область поста, до якої прокручуємо перед взаємодією з Like. */
export const postLikeAreaSelector =
    `${postDialogSelector} div[data-visualcompletion="ignore-dynamic"]`;

/** Коментарі верхнього рівня у відкритому Facebook-пості. */
export const topLevelCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Comment by "]';

/** Відповіді на коментарі у відкритому Facebook-пості. */
export const replyCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Reply by "]';

/** Усі коментарі та відповіді у відкритому Facebook-пості. */
export const allPostCommentSelector =
    `${topLevelCommentSelector}, ${replyCommentSelector}`;

/** Кнопки, доступні всередині модального вікна поста. */
export const commentButtonSelector =
    `${postDialogSelector} [role="button"]`;

/** Поле введення відповіді на конкретний коментар. */
export const replyInputSelector =
    '[contenteditable="true"][role="textbox"]'
    + '[aria-label^="Reply to "]';

/** Поле введення нового коментаря під постом. */
export const commentInputSelector =
    'form[role="presentation"] '
    + 'div[contenteditable="true"][role="textbox"]';

/** Кнопка поточного порядку сортування коментарів. */
export const commentOrderingButtonSelector =
    `${postDialogSelector} `
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span)';

/** Меню вибору порядку сортування коментарів. */
export const commentOrderingMenuSelector =
    '[aria-label="Comment Ordering"][role="menu"]';

/** Окремий пункт меню сортування коментарів. */
export const commentOrderingMenuItemSelector =
    '[role="menuitem"]';
