import assert from "node:assert/strict";

import getAdAccountAccessRequest, {
    getAdAccountAccessRequestStatuses,
} from "../facebook/api-actions/ads-manager/getAdAccountAccessRequest.js";
import acceptAdAccountAccessRequest, {
    acceptAdAccountAccessRequestStatuses,
} from "../facebook/api-actions/ads-manager/acceptAdAccountAccessRequest.js";
import rejectAdAccountAccessRequest, {
    rejectAdAccountAccessRequestStatuses,
} from "../facebook/api-actions/ads-manager/rejectAdAccountAccessRequest.js";


const ids = {
    adAccountId: "1760236478435080",
    agencyId: "703191138787237",
    adMarketId: "120252063622850734",
};
const page = {
    url: () => "https://adsmanager.facebook.com/adsmanager/manage",
    evaluate: (callback, args) => callback(args),
};
const dialog = JSON.stringify({
    payload: `<a href="/adaccount/agency/request/accept_reject/?ad_market_id=${ids.adMarketId}&amp;agency_id=${ids.agencyId}&amp;operation=0&amp;ext=1791115362&amp;hash=accept_hash">Accept</a><a href="/adaccount/agency/request/accept_reject/?ad_market_id=${ids.adMarketId}&amp;agency_id=${ids.agencyId}&amp;operation=1&amp;ext=1791115362&amp;hash=reject_hash">Reject</a>`,
});
const originalFetch = globalThis.fetch;
const originalRequire = globalThis.require;

function mockSession(handler) {
    globalThis.require = (name) => ({
        CurrentUserInitialData: { USER_ID: "123456789" },
        DTSG_ASYNC: { getCachedToken: () => "abc" },
        DTSGInitialData: { token: "abc" },
        LSD: { token: "lsd-token" },
    })[name];
    globalThis.fetch = handler;
}

function reply(body, status = 200) {
    return { ok: status < 400, status, text: async () => body };
}

try {
    const calls = [];
    mockSession(async (url, options) => {
        calls.push({ url, options });
        return reply(`for (;;);${dialog}`);
    });
    const found = await getAdAccountAccessRequest({ page, ...ids });
    assert.equal(found.status, getAdAccountAccessRequestStatuses.FOUND);
    assert.equal(found.success, true);
    assert.deepEqual(found.data.accept, { ext: "1791115362", hash: "accept_hash" });
    assert.deepEqual(found.data.reject, { ext: "1791115362", hash: "reject_hash" });
    assert.equal(calls[0].options.credentials, "include");
    const getUrl = new URL(calls[0].url, "https://adsmanager.facebook.com");
    assert.equal(getUrl.searchParams.get("fb_dtsg_ag"), "abc");
    assert.equal(getUrl.searchParams.get("jazoest"), "2294");
    assert.equal(getUrl.searchParams.get("__aaid"), ids.adAccountId);

    mockSession(async () => reply('for (;;);{"payload":"<a href=\\"/adaccount/agency/request/accept_reject/?ad_market_id=999&amp;agency_id=703191138787237&amp;operation=0&amp;ext=1791115362&amp;hash=wrong_hash\\">Accept</a>"}'));
    const otherRequest = await getAdAccountAccessRequest({ page, ...ids });
    assert.equal(otherRequest.status, getAdAccountAccessRequestStatuses.NOT_FOUND);

    mockSession(async () => reply(`for (;;);${JSON.stringify({
        payload: `<a href="/adaccount/agency/request/accept_reject/?ad_market_id=${ids.adMarketId}&amp;agency_id=${ids.agencyId}&amp;operation=0&amp;ext=1791115362&amp;hash=accept_hash">Accept</a>`,
    })}`));
    const incomplete = await getAdAccountAccessRequest({ page, ...ids });
    assert.equal(incomplete.status, getAdAccountAccessRequestStatuses.DIALOG_INCOMPLETE);

    for (const [action, expectedOperation, expectedHash, expectedStatus] of [
        [acceptAdAccountAccessRequest, "0", "accept_hash", acceptAdAccountAccessRequestStatuses.ACCEPTED],
        [rejectAdAccountAccessRequest, "1", "reject_hash", rejectAdAccountAccessRequestStatuses.REJECTED],
    ]) {
        const requests = [];
        mockSession(async (url, options) => {
            requests.push({ url, options });
            return reply('for (;;);{"__ar":1,"payload":null}');
        });
        const result = await action({ page, invite: found.data });
        assert.equal(result.success, true);
        assert.equal(result.status, expectedStatus);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, expectedOperation === "0"
            ? "/adaccount/agency/request/accept_reject/?ads_manager_write_regions=true"
            : "/adaccount/agency/request/accept_reject/");
        assert.equal(requests[0].options.method, "POST");
        assert.equal(requests[0].options.credentials, "include");
        assert.equal(requests[0].options.headers["content-type"], "application/x-www-form-urlencoded");
        assert.equal(requests[0].options.headers["x-fb-lsd"], expectedOperation === "0" ? "lsd-token" : undefined);
        const body = new URLSearchParams(requests[0].options.body);
        assert.equal(body.get("operation"), expectedOperation);
        assert.equal(body.get("hash"), expectedHash);
        assert.equal(body.get("ext"), "1791115362");
        assert.equal(body.get("fb_dtsg"), "abc");
        assert.equal(body.get("lsd"), "lsd-token");
        assert.deepEqual([...body.keys()].sort(), [
            "ad_market_id", "agency_id", "operation", "ext", "hash", "__aaid",
            "__user", "__a", "fb_dtsg", "jazoest", "lsd",
        ].sort());
        assert.equal(result.httpStatus, 200);
        assert.deepEqual(result.response, { __ar: 1, payload: null });
    }

    let requestCount = 0;
    mockSession(async (_url, options) => {
        requestCount += 1;
        return reply('for (;;);{"__ar":1,"payload":null}');
    });
    const invalid = await acceptAdAccountAccessRequest({ page, invite: ids });
    assert.equal(invalid.status, acceptAdAccountAccessRequestStatuses.INVALID_INPUT);
    assert.equal(requestCount, 0);

    mockSession(async () => reply('for (;;);{"__ar":1,"error":{"code":100,"message":"Request expired"}}'));
    const rejectedByFacebook = await acceptAdAccountAccessRequest({ page, invite: found.data });
    assert.equal(rejectedByFacebook.status, acceptAdAccountAccessRequestStatuses.FACEBOOK_ERROR);
    assert.equal(rejectedByFacebook.success, false);

    mockSession(async () => reply('for (;;);{"__ar":1,"error":2859017,"errorSummary":"Action not allowed"}'));
    const forbidden = await acceptAdAccountAccessRequest({ page, invite: found.data });
    assert.equal(forbidden.success, false);
    assert.equal(forbidden.status, acceptAdAccountAccessRequestStatuses.FACEBOOK_ERROR);
    assert.equal(forbidden.facebookError.code, 2859017);
    assert.equal(forbidden.response.errorSummary, "Action not allowed");

    mockSession(async () => reply('for (;;);{"payload":null}'));
    const acceptedWithoutAr = await acceptAdAccountAccessRequest({ page, invite: found.data });
    assert.equal(acceptedWithoutAr.success, true);
    assert.equal(acceptedWithoutAr.status, acceptAdAccountAccessRequestStatuses.ACCEPTED);

    mockSession(async () => reply('for (;;);{"error":{"code":100,"message":"Session expired"}}'));
    const error = await getAdAccountAccessRequest({ page, ...ids });
    assert.equal(error.status, getAdAccountAccessRequestStatuses.FACEBOOK_ERROR);
} finally {
    globalThis.fetch = originalFetch;
    if (originalRequire === undefined) delete globalThis.require;
    else globalThis.require = originalRequire;
}

console.log("Перевірка pending-запиту BM та Accept/Reject пройшла успішно");
