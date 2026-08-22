import assert from "node:assert/strict";

import { facebookNameChangeSelectors } from "../facebook/selectors/accountCenter.js";
import {
    facebookLanguageSelector,
    firstLanguageResultSelector,
    languageDialogSelector,
    languageSearchInputSelector,
    languageSettingsButtonSelector,
} from "../facebook/selectors/language.js";
import { dismissPopupButtonSelector } from "../facebook/selectors/overlays.js";
import {
    allPostCommentSelector,
    availablePostSelector,
    commentButtonSelector,
    commentInputSelector,
    commentOrderingButtonSelector,
    commentOrderingMenuItemSelector,
    commentOrderingMenuSelector,
    postDialogSelector,
    postLikeAreaSelector,
    replyCommentSelector,
    replyInputSelector,
    topLevelCommentSelector,
} from "../facebook/selectors/post.js";
import {
    getReactionOptionSelector,
    reactionButtonSelector,
    reactionsToolbarSelector,
} from "../facebook/selectors/reactions.js";
import {
    allPostCommentSelector as compatibleAllPostCommentSelector,
    postDialogSelector as compatiblePostDialogSelector,
} from "../facebook/post/selectors.js";
import {
    availablePostSelector as compatibleAvailablePostSelector,
} from "../facebook/post/checks/isPostAvailable.js";
import {
    facebookNameChangeSelectors as compatibleNameChangeSelectors,
} from "../facebook/actions/changeFacebookName.js";
import {
    commentOrderingButtonSelector as compatibleOrderingButtonSelector,
    commentOrderingMenuItemSelector as compatibleOrderingMenuItemSelector,
    commentOrderingMenuSelector as compatibleOrderingMenuSelector,
} from "../facebook/actions/sortCommentsByNewest.js";


assert.equal(
    postDialogSelector,
    'div[role="dialog"][aria-labelledby]'
);
assert.equal(
    availablePostSelector,
    'div[role="dialog"] div[class^="html-div"] > *'
    + ' > div[data-visualcompletion="ignore-dynamic"]'
    + ' > div > div:nth-of-type(1)'
);
assert.equal(postLikeAreaSelector, availablePostSelector);
assert.equal(
    topLevelCommentSelector,
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Comment by "]'
);
assert.equal(
    replyCommentSelector,
    `${postDialogSelector} `
    + '[role="article"][aria-label^="Reply by "]'
);
assert.equal(
    allPostCommentSelector,
    `${topLevelCommentSelector}, ${replyCommentSelector}`
);
assert.equal(
    commentButtonSelector,
    `${postDialogSelector} [role="button"]`
);
assert.equal(
    replyInputSelector,
    '[contenteditable="true"][role="textbox"]'
    + '[aria-label^="Reply to "]'
);
assert.equal(
    commentInputSelector,
    'form[role="presentation"] div[contenteditable="true"][role="textbox"]'
);
assert.equal(
    commentOrderingButtonSelector,
    `${postDialogSelector} `
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span)'
);
assert.equal(
    commentOrderingMenuSelector,
    '[aria-label="Comment Ordering"][role="menu"]'
);
assert.equal(commentOrderingMenuItemSelector, '[role="menuitem"]');

assert.equal(
    reactionButtonSelector,
    'div[role="dialog"][aria-modal="true"][aria-labelledby] '
    + 'div[data-visualcompletion="ignore-dynamic"] [aria-label]'
);
assert.equal(
    reactionsToolbarSelector,
    'div[data-visualcompletion="ignore-dynamic"]'
    + '[aria-label="Reactions"][role="dialog"] [role="toolbar"]'
);
assert.equal(
    getReactionOptionSelector("Love"),
    `${reactionsToolbarSelector} [aria-label="Love"]`
);

assert.deepEqual(facebookNameChangeSelectors, {
    accountOverview: 'a[href*="account_overview"]',
    accountOverviewDialog:
        'div[role="dialog"][aria-modal="true"]',
    accountOverviewDialogLink:
        'div[role="dialog"][aria-modal="true"] '
        + 'a[role="link"][href*="entrypoint=account_overview"]',
    profile:
        'div[role="list"] [role="listitem"] [aria-label] '
        + '[aria-hidden="true"][role="presentation"]',
    profileDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby] '
        + '[aria-hidden="false"]',
    nameLink: 'a[role="link"][aria-label="Name"]',
    nameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"] '
        + '[aria-hidden="false"]',
    anyNameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"]',
    anyDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby]',
    visibleDialogs:
        'div[role="dialog"][aria-modal="true"]',
    finalName: 'h3[dir="auto"] > span',
});

assert.equal(facebookLanguageSelector, 'html[id="facebook"][lang]');
assert.equal(
    languageSettingsButtonSelector,
    'div[role="main"] div[style^="border-radius"] '
    + 'div[class^="html-div"] div[role="button"]'
);
assert.equal(
    languageDialogSelector,
    'div[aria-labelledby][role="dialog"]'
);
assert.equal(
    languageSearchInputSelector,
    `${languageDialogSelector} input[placeholder][type="text"]`
);
assert.equal(
    firstLanguageResultSelector,
    `${languageDialogSelector} `
    + 'div[data-visualcompletion="ignore-dynamic"] > div:nth-of-type(1)'
);
assert.equal(
    dismissPopupButtonSelector,
    'button[aria-label], [role="button"][aria-label]'
);

assert.equal(compatiblePostDialogSelector, postDialogSelector);
assert.equal(compatibleAllPostCommentSelector, allPostCommentSelector);
assert.equal(compatibleAvailablePostSelector, availablePostSelector);
assert.equal(compatibleNameChangeSelectors, facebookNameChangeSelectors);
assert.equal(
    compatibleOrderingButtonSelector,
    commentOrderingButtonSelector
);
assert.equal(
    compatibleOrderingMenuSelector,
    commentOrderingMenuSelector
);
assert.equal(
    compatibleOrderingMenuItemSelector,
    commentOrderingMenuItemSelector
);

console.log("Facebook selector contract tests passed");
