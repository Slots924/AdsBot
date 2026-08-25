import {
    MAN_TAG_ID,
    WOMAN_TAG_ID,
} from "../../../config.js";
import getProfileGender from "../getProfileGender.js";


export default async function markProfileGender(
    adsPower,
    profile,
    gender
) {
    const normalizedGender = gender === "female" ? "female" : "male";
    const tagId = normalizedGender === "female"
        ? WOMAN_TAG_ID
        : MAN_TAG_ID;

    if (getProfileGender(profile) === normalizedGender) {
        return {
            added: false,
            alreadyMarked: true,
            tagId,
            gender: normalizedGender,
        };
    }

    if (!profile?.profile_id) {
        throw new Error(
            "У профілю відсутній profile_id"
        );
    }

    await adsPower.updateProfileTags(
        profile.profile_id,
        [tagId],
        "2"
    );

    return {
        added: true,
        alreadyMarked: false,
        tagId,
        gender: normalizedGender,
    };
}
