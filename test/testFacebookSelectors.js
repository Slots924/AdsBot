import assert from "node:assert/strict";

import { facebookNameChangeSelectors } from "../facebook/selectors/accountCenter.js";
import {
    facebookLanguageSelector,
    firstLanguageResultSelector,
    languageDialogSelector,
    languageSearchInputSelector,
    languageSettingsButtonSelector,
} from "../facebook/selectors/language.js";
import {
    dismissPopupButtonSelector,
    modalDialogSelector,
} from "../facebook/selectors/overlays.js";
import {
    personalProfileAudienceDoneButtonSelector,
    personalProfileAudienceRadioSelector,
    personalProfileComposerButtonCandidatesSelector,
    personalProfileCreatePostDialogSelector,
    personalProfilePhotoVideoButtonSelector,
    personalProfilePostPrivacyButtonSelector,
    personalProfilePublishPostButtonSelector,
} from "../facebook/selectors/personalProfilePost.js";
import {
    personalProfileEditDateCancelButtonSelector,
    personalProfileEditDateComboboxSelector,
    personalProfileEditDateDialogSelector,
    personalProfileEditDateDoneButtonSelector,
    personalProfilePostActionsButtonSelector,
    personalProfilePostCloseButtonSelector,
    personalProfilePostMenuItemSelector,
} from "../facebook/selectors/personalProfilePostDate.js";
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
    createNewAccountSelector,
    logInButtonSelector,
    useAnotherProfileSelector,
} from "../facebook/selectors/login.js";
import {
    getReactionOptionSelector,
    reactionButtonSelector,
    reactionsToolbarSelector,
} from "../facebook/selectors/reactions.js";
import {
    chooseProfilePictureMenuItemSelector,
    coverPhotoEditingMenuItemSelector,
    coverPhotoEditingMenuSelector,
    coverPhotoImageSelector,
    coverPhotoUploadInputSelector,
    chooseProfilePictureDialogSelector,
    editCoverPhotoButtonSelector,
    profilePictureImageSelector,
    profilePictureActionsButtonSelector,
    profilePictureUploadInputSelector,
    saveCoverPhotoButtonSelector,
    saveProfilePictureButtonSelector,
    updateProfilePictureButtonSelector,
    uploadProfilePhotoButtonSelector,
} from "../facebook/selectors/profile.js";
import {
    getPersonalProfileFeedPostActionsButtonSelector,
    getPersonalProfileFeedPostSelector,
    personalProfileFeedPostActionButtonSelector,
    personalProfileFeedPostMenuItemSelector,
    personalProfileMoveToTrashButtonSelector,
} from "../facebook/selectors/personalProfileFeedPosts.js";
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
    'div[role="dialog"][aria-modal="true"][aria-labelledby]'
);
assert.equal(
    availablePostSelector,
    postDialogSelector
);
assert.equal(
    postLikeAreaSelector,
    `${postDialogSelector} div[data-visualcompletion="ignore-dynamic"]`
);
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
    nameLink:
        '[role="dialog"][aria-modal="true"] [aria-label="Name" i]',
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
assert.equal(
    modalDialogSelector,
    'div[role="dialog"][aria-modal="true"]'
);
assert.equal(
    updateProfilePictureButtonSelector,
    'div[role="main"] '
    + 'div[role="button"][aria-label="Update profile picture"]'
);
assert.equal(
    profilePictureActionsButtonSelector,
    'div[role="main"] '
    + 'div[role="button"][aria-label="Profile picture actions"]'
);
assert.equal(
    chooseProfilePictureMenuItemSelector,
    'div[role="menuitem"]'
);
assert.equal(
    chooseProfilePictureDialogSelector,
    'div[role="dialog"][aria-modal="true"]'
    + '[aria-label="Choose profile picture"]'
);
assert.equal(
    uploadProfilePhotoButtonSelector,
    `${chooseProfilePictureDialogSelector} `
    + 'div[role="button"][aria-label="Upload photo" i]'
);
assert.equal(
    profilePictureUploadInputSelector,
    `${chooseProfilePictureDialogSelector} `
    + 'input[type="file"]'
    + '[accept="image/*,image/heif,image/heic"]'
);
assert.equal(
    saveProfilePictureButtonSelector,
    `${chooseProfilePictureDialogSelector} `
    + 'div[role="button"][aria-label="Save"]'
);
assert.equal(
    profilePictureImageSelector,
    'div[role="main"] '
    + 'div[role="button"][aria-label="Profile picture actions"] image'
);
assert.equal(
    coverPhotoImageSelector,
    'div[role="main"] '
    + 'a[role="link"][aria-label="View profile cover photo" i] img'
);
assert.equal(
    editCoverPhotoButtonSelector,
    '[aria-label*="cover photo" i][aria-label*="edit" i]'
    + ':is([role="button"], [role="menu"])'
);
assert.equal(
    coverPhotoEditingMenuSelector,
    'div[role="menu"][aria-label="Cover photo editing options" i]'
);
assert.equal(
    coverPhotoEditingMenuItemSelector,
    `${coverPhotoEditingMenuSelector} [role="menuitem"]`
);
assert.equal(
    coverPhotoUploadInputSelector,
    'input[type="file"][accept="image/*,image/heif,image/heic"]'
);
assert.equal(
    saveCoverPhotoButtonSelector,
    'div[role="main"] '
    + 'div[role="button"][aria-label="Save changes" i]'
);
assert.equal(
    personalProfileComposerButtonCandidatesSelector,
    'div[role="main"] div[role="button"]'
);
assert.equal(
    personalProfileCreatePostDialogSelector,
    `${modalDialogSelector}[aria-label="Create post" i]`
);
assert.equal(
    personalProfilePostPrivacyButtonSelector,
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label^="Edit privacy." i]'
);
assert.equal(
    personalProfileAudienceRadioSelector,
    `${personalProfileCreatePostDialogSelector} input[type="radio"]`
);
assert.equal(
    personalProfileAudienceDoneButtonSelector,
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"]'
    + '[aria-label="Done with privacy audience selection and close dialog" i]'
);
assert.equal(
    personalProfilePhotoVideoButtonSelector,
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label="Photo/video" i]'
);
assert.equal(
    personalProfilePublishPostButtonSelector,
    `${personalProfileCreatePostDialogSelector} `
    + '[role="button"][aria-label="Post" i]'
);
assert.equal(
    personalProfilePostActionsButtonSelector,
    `${postDialogSelector} `
    + '[role="button"][aria-haspopup="menu"]'
    + '[aria-label^="Actions for this post by " i]'
);
assert.equal(
    personalProfilePostMenuItemSelector,
    '[role="menu"] [role="menuitem"]'
);
assert.equal(
    personalProfileEditDateDialogSelector,
    'div[role="dialog"][aria-modal="true"][aria-labelledby]'
);
assert.equal(
    personalProfileEditDateComboboxSelector,
    'input[role="combobox"][type="text"]'
);
assert.equal(
    personalProfileEditDateDoneButtonSelector,
    '[role="button"][aria-label="Done" i]'
);
assert.equal(
    personalProfileEditDateCancelButtonSelector,
    '[role="button"][aria-label="Cancel editing timeline date" i]'
);
assert.equal(
    personalProfilePostCloseButtonSelector,
    '[role="button"][aria-label="Close" i]'
);

assert.equal(
    getPersonalProfileFeedPostSelector(1),
    '[aria-posinset="1"]'
);
assert.equal(
    getPersonalProfileFeedPostActionsButtonSelector(1),
    '[aria-posinset="1"] [role="button"][aria-haspopup="menu"]'
        + '[aria-label^="Actions for this post by" i]'
);
assert.equal(
    personalProfileFeedPostMenuItemSelector,
    '[role="menu"] [role="menuitem"]'
);
assert.equal(
    personalProfileFeedPostActionButtonSelector,
    '[role="button"]'
);
assert.equal(
    personalProfileMoveToTrashButtonSelector,
    '[role="dialog"][aria-label="Move to your trash?" i] '
        + '[role="button"][aria-label="Move" i]'
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

assert.match(
    createNewAccountSelector,
    /a\[aria-label="Create new account" i\]/
);
assert.match(
    createNewAccountSelector,
    /a\[aria-label="Neues Konto erstellen" i\]/
);
assert.match(
    createNewAccountSelector,
    /a\[aria-label="Створити новий обліковий запис" i\]/
);
assert.match(
    useAnotherProfileSelector,
    /\[role="button"\]\[aria-label="Use another profile" i\]/
);
assert.match(
    useAnotherProfileSelector,
    /\[role="button"\]\[aria-label="Використати інший профіль" i\]/
);
assert.match(
    logInButtonSelector,
    /\[role="button"\]\[aria-label="Log In" i\]/
);
assert.match(
    logInButtonSelector,
    /\[role="button"\]\[aria-label="Увійти" i\]/
);

console.log("Facebook selector contract tests passed");
