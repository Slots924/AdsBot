import buildForm from "./buildForm.js";
import parseResponse from "./parseResponse.js";

// Викликається всередині черги клієнта; самостійно не створює нову сесію.
export default async function requestGraphql(fbData, operation, variables, { signal, mutation = true, beforeSend } = {}) {
    signal?.throwIfAborted();
    fbData.client.validateFbData(fbData);
    const form = buildForm(fbData, { ...operation, variables });
    await beforeSend?.();
    signal?.throwIfAborted();
    const response = await fbData.client.request({
        url: "https://www.facebook.com/api/graphql/", method: "post", data: form.toString(), signal,
        mutation, allowHttpErrors: true,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": operation.friendlyName, "X-FB-LSD": fbData.session.lsd },
    });
    return parseResponse(response, { session: fbData.session, mutation });
}
