import {
    MAN_TAG_ID,
    WOMAN_TAG_ID,
} from "../../config.js";


export default function getProfileGender(profile) {
    const tags = Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];
    const tagIds = new Set(
        tags.map((tag) => String(tag.id))
    );
    const hasManTag = tagIds.has(String(MAN_TAG_ID));
    const hasWomanTag = tagIds.has(String(WOMAN_TAG_ID));

    if (hasManTag === hasWomanTag) {
        return null;
    }

    return hasManTag ? "male" : "female";
}
