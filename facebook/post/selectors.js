export const postDialogSelector =
    'div[role="dialog"][aria-labelledby]';

export const topLevelCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Comment by "]';

export const replyCommentSelector =
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Reply by "]';

export const allPostCommentSelector =
    `${topLevelCommentSelector}, ${replyCommentSelector}`;

export const commentButtonSelector =
    `${postDialogSelector} [role="button"]`;

export const replyInputSelector =
    '[contenteditable="true"][role="textbox"]'
    + '[aria-label^="Reply to "]';
