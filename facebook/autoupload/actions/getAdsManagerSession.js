import parseWebSession from "../../session/parseWebSession.js";
import { extractFacebookAccessTokenFromHtml } from "../../api/browserCredentials.js";
import { actionError } from "../graphql/errors.js";

// Токен залишається у приватному стані клієнта; зовні повертаються лише ознаки наявності.
export default async function getAdsManagerSession(fbData, { signal } = {}) {
    return fbData.client.run(async () => {
        fbData.client.validateFbData(fbData);
        const response = await fbData.client.request({ url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns", signal });
        const { session } = parseWebSession(response.data);
        if (String(session.FacebookID) !== String(fbData.userId)) throw actionError("Ads Manager не підтвердив поточний акаунт", "ADS_MANAGER_ACCOUNT_MISMATCH");
        const accessToken = extractFacebookAccessTokenFromHtml(response.data, { prefix: "EAAB" });
        if (!accessToken) throw actionError("У відповіді Ads Manager не знайдено access token", "ADS_MANAGER_ACCESS_TOKEN_NOT_FOUND");
        fbData.client.setAdsManagerSession({ session, accessToken, checkedAt: new Date().toISOString() });
        return { hasAdsManagerSession: true, hasAccessToken: true };
    });
}
