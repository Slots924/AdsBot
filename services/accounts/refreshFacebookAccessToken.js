import FacebookWebClient from "../../facebook/api/FacebookWebClient.js";
import getAdsManagerSession from "../../facebook/autoupload/actions/getAdsManagerSession.js";
import { withHttpWorkflow } from "../reports/HttpExchangeTrace.js";

export default function refreshFacebookAccessToken({ accountKey, accountManager, httpClient, signal, directory }) {
    return withHttpWorkflow("refreshFacebookAccessToken", async () => {
        const { cookie, userAgent } = await accountManager.getHttpCredentials(accountKey);
        const client = new FacebookWebClient({ cookies: cookie, userAgent, httpClient });
        await getAdsManagerSession({ client, profileId: accountKey }, { signal, refreshSession: true });
        signal?.throwIfAborted();
        const { accessToken } = client.getApiCredentials(client.getFbData(accountKey));
        await accountManager.update(accountKey, { accessToken });
        return { accountKey, accessTokenUpdated: true };
    }, { directory, metadata: { accountKey } });
}
