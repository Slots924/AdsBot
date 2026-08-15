import { BAN_TAG_ID } from "../../../config.js";


export default function hasBanTag(profile) {
    // Якщо profile_tags немає, використовуємо порожній масив
    const profileTags = Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];

    // Перевіряємо, чи серед тегів є BAN
    return profileTags.some(
        (tag) => String(tag.id) === String(BAN_TAG_ID)
    );
}
