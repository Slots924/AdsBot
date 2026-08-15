import { LOGIN_ERROR_TAG_ID } from "../../../config.js";
import hasLoginErrorTag from "./hasLoginErrorTag.js";


export default async function markProfileAsLoginError(
    adsPower,
    profile
) {
    // Не надсилаємо повторний запит, якщо профіль уже має тег
    if (hasLoginErrorTag(profile)) {
        return {
            added: false,
            alreadyMarked: true,
            tagId: LOGIN_ERROR_TAG_ID,
        };
    }

    // Для оновлення тегів потрібен profile_id
    if (!profile?.profile_id) {
        throw new Error(
            "У профілю відсутній profile_id"
        );
    }

    /*
        Тип оновлення "2" додає Login Error до поточних тегів,
        не видаляючи інші теги профілю.
    */
    await adsPower.updateProfileTags(
        profile.profile_id,
        [LOGIN_ERROR_TAG_ID],
        "2"
    );

    return {
        added: true,
        alreadyMarked: false,
        tagId: LOGIN_ERROR_TAG_ID,
    };
}
