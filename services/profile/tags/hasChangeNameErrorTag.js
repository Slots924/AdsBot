import { CHANGE_NAME_ERROR_TAG_ID } from "../../../config.js";


export default function hasChangeNameErrorTag(profile) {
    const profileTags = Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];

    return profileTags.some(
        (tag) => String(tag.id) === String(CHANGE_NAME_ERROR_TAG_ID)
    );
}
