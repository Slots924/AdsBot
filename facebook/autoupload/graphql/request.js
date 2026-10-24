import buildForm from "./buildForm.js";
import parseResponse from "./parseResponse.js";

// Викликається всередині черги клієнта; самостійно не створює нову сесію.
export default async function requestGraphql(fbData, operation, variables, { signal, mutation = true, beforeSend, accountsCenter = false, formSession = fbData.session } = {}) {
    signal?.throwIfAborted();
    fbData.client.validateFbData(fbData);
    const form = buildForm({ ...fbData, session: formSession }, { ...operation, variables });
    if (accountsCenter) form.set("__crn", "comet.fx.accounts_center.name.editor");
    await beforeSend?.();
    signal?.throwIfAborted();
    const response = await fbData.client.request({
        url: accountsCenter ? "https://accountscenter.facebook.com/api/graphql/" : "https://www.facebook.com/api/graphql/", method: "post", data: form.toString(), signal,
        mutation, allowHttpErrors: true,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": operation.friendlyName, "X-FB-LSD": formSession.lsd,
            ...(accountsCenter ? { Origin: "https://accountscenter.facebook.com", Referer: "https://accountscenter.facebook.com/profiles/" } : {}),
        },
    });
    return parseResponse(response, { session: formSession, mutation });
}
