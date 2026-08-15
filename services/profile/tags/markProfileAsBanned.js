import { BAN_TAG_ID } from "../../../config.js";
import hasBanTag from "./hasBanTag.js";


export default async function markProfileAsBanned(
    adsPower,
    profile
) {
    /*
        Спочатку перевіряємо, чи BAN уже є.

        Так ми не будемо повторно відправляти
        запит до AdsPower.
    */
    if (hasBanTag(profile)) {
        return {
            added: false,
            alreadyBanned: true,
            tagId: BAN_TAG_ID,
        };
    }


    // Для оновлення тегів потрібен profile_id
    if (!profile?.profile_id) {
        throw new Error(
            "У профілю відсутній profile_id"
        );
    }


    /*
        Додаємо лише тег BAN.

        updateType "2" означає:
        додати тег до поточних тегів,
        не видаляючи інші.
    */
    await adsPower.updateProfileTags(
        profile.profile_id,
        [BAN_TAG_ID],
        "2"
    );


    return {
        added: true,
        alreadyBanned: false,
        tagId: BAN_TAG_ID,
    };
}
