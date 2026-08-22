import { waitHuman } from "../browser/timing.js";
import openPageWithoutPopups from "./openPageWithoutPopups.js";


export const FACEBOOK_USER_PROFILE_URL =
    "https://www.facebook.com/profile.php";


export function buildFacebookUserProfileUrl(profileId) {
    if (
        typeof profileId !== "string"
        || !/^\d+$/.test(profileId.trim())
    ) {
        throw new TypeError(
            "Facebook profile ID має бути непорожнім рядком із цифр"
        );
    }

    return `${FACEBOOK_USER_PROFILE_URL}?id=${profileId.trim()}`;
}


export default async function openFacebookUserProfile(
    page,
    profileId,
    {
        timeout = 60000,
        random = Math.random,
        sleep,
    } = {}
) {
    try {
        const profileUrl = buildFacebookUserProfileUrl(profileId);

        await openPageWithoutPopups(page, profileUrl, {
            timeout,
        });
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );
        await waitHuman("long", {
            random,
            ...(sleep ? { sleep } : {}),
        });

        return true;
    } catch (error) {
        console.error(
            "Не вдалося відкрити Facebook-профіль користувача:",
            error.message
        );
        return false;
    }
}
