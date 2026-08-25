import { CHANGE_NAME_ERROR_TAG_ID } from "../../../config.js";
import hasChangeNameErrorTag from "./hasChangeNameErrorTag.js";


export default async function markProfileAsChangeNameError(
    adsPower,
    profile
) {
    if (hasChangeNameErrorTag(profile)) {
        return {
            added: false,
            alreadyMarked: true,
            tagId: CHANGE_NAME_ERROR_TAG_ID,
        };
    }

    if (!profile?.profile_id) {
        throw new Error(
            "У профілю відсутній profile_id"
        );
    }

    await adsPower.updateProfileTags(
        profile.profile_id,
        [CHANGE_NAME_ERROR_TAG_ID],
        "2"
    );

    return {
        added: true,
        alreadyMarked: false,
        tagId: CHANGE_NAME_ERROR_TAG_ID,
    };
}
