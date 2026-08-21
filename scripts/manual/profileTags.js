import "dotenv/config";

import AdsPower from "../../classes/AdsPower.js";


// Вкажіть номер профілю AdsPower для перевірки
const profileNo = 1466;


export async function getProfileTags(selectedProfileNo) {
    if (!selectedProfileNo) {
        throw new Error(
            "Не вказано номер профілю AdsPower"
        );
    }

    const adsPower = new AdsPower();
    const profile = await adsPower.getProfileByNo(selectedProfileNo);

    return Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];
}


async function testProfileTags() {
    try {
        const tags = await getProfileTags(profileNo);

        console.log(`Теги профілю ${profileNo}:`);
        console.log(tags);
    } catch (error) {
        console.error(
            "Не вдалося отримати теги профілю:",
            error.message
        );
        process.exitCode = 1;
    }
}


testProfileTags();
