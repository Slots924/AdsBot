import getProfileGender from "../profile/getProfileGender.js";
import hasBanTag from "../profile/tags/hasBanTag.js";
import hasChangeNameErrorTag from "../profile/tags/hasChangeNameErrorTag.js";
import hasLoginErrorTag from "../profile/tags/hasLoginErrorTag.js";


export const commentAccountSetupSkipReasons = Object.freeze({
    BANNED: "BANNED",
    LOGIN_ERROR: "LOGIN_ERROR",
    CHANGE_NAME_ERROR: "CHANGE_NAME_ERROR",
    ALREADY_SETUP: "ALREADY_SETUP",
});


export default function getCommentAccountSetupSkipReason(profile) {
    if (hasBanTag(profile)) {
        return commentAccountSetupSkipReasons.BANNED;
    }

    if (hasLoginErrorTag(profile)) {
        return commentAccountSetupSkipReasons.LOGIN_ERROR;
    }

    if (hasChangeNameErrorTag(profile)) {
        return commentAccountSetupSkipReasons.CHANGE_NAME_ERROR;
    }

    if (getProfileGender(profile)) {
        return commentAccountSetupSkipReasons.ALREADY_SETUP;
    }

    return null;
}


export function describeCommentAccountSetupSkipReason(reason) {
    switch (reason) {
        case commentAccountSetupSkipReasons.BANNED:
            return "Профіль має тег BAN";
        case commentAccountSetupSkipReasons.LOGIN_ERROR:
            return "Профіль має тег Login Error";
        case commentAccountSetupSkipReasons.CHANGE_NAME_ERROR:
            return "Профіль має тег Change Name Error";
        case commentAccountSetupSkipReasons.ALREADY_SETUP:
            return "Профіль уже має тег статі Man або Woman";
        default:
            return "Профіль пропущено";
    }
}
