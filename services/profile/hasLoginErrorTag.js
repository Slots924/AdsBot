import { LOGIN_ERROR_TAG_ID } from "../../config.js";


export default function hasLoginErrorTag(profile) {
    // Якщо profile_tags немає, використовуємо порожній масив
    const profileTags = Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];

    // Перевіряємо тег за ID, оскільки його назва може змінитися
    return profileTags.some(
        (tag) => String(tag.id) === String(LOGIN_ERROR_TAG_ID)
    );
}
