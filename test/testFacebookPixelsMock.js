import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";


const requests = [];
const api = new FacebookGraphApi({
    accountKey: "client",
    accessToken: "secret",
    cookie: "cookie",
    userAgent: "agent",
    proxyHttpClient: {
        async request(config) {
            requests.push(config);
            if (config.params.after === "next-pixels") {
                return { data: { data: [{ id: "2", name: "Pixel 2", secret: "ignored" }] } };
            }
            return { data: {
                data: [{ id: "1", name: "Pixel 1", access_token: "must-not-leak" }],
                paging: { cursors: { after: "next-pixels" }, next: "https://graph.facebook.com/secret" },
            } };
        },
    },
});

assert.deepEqual(await api.getAdPixels("act_1"), [
    { id: "1", name: "Pixel 1" },
    { id: "2", name: "Pixel 2" },
]);
assert.equal(requests[1].params.after, "next-pixels");
assert.equal(JSON.stringify(await api.getAdPixels("act_1")).includes("access_token"), false);
console.log("Mock-перевірка пагінації Pixel пройшла успішно");
