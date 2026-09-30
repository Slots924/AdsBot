import assert from "node:assert/strict";

import SmsPoolPhoneVerificationManager, {
    facebookSmsPoolService,
    normalizeBalance,
    normalizeCountries,
    normalizeHistory,
} from "../services/personalAccounts/SmsPoolPhoneVerificationManager.js";


assert.equal(normalizeBalance({ balance: "12.45" }), 12.45);
assert.deepEqual(normalizeCountries([
    { ID: "1", name: "United States", region: "Americas" },
], [{ code: "US", name: "United States", aliases: [] }]), [{
    id: "1",
    iso: "US",
    name: "United States",
    dialingCode: "1",
}]);
assert.equal(normalizeHistory([
    { order_code: "pending", phonenumber: "100", code: "0" },
    { order_code: "done", phonenumber: "2025550100", code: "123456", short_name: "US", service: "Facebook" },
]).length, 1);

const calls = [];
const smsPool = {
    async getBalance() { return { balance: "9.50" }; },
    async listCountries() { return [{ ID: "1", name: "United States" }]; },
    async getSmsOrderHistory() { return []; },
    async purchaseSms(input) {
        calls.push(["purchase", input]);
        return {
            success: 1,
            number: "12025550100",
            phonenumber: "2025550100",
            cc: "1",
            order_id: "ORDER1",
            country: "United States",
            service: facebookSmsPoolService,
            cost: "0.24",
        };
    },
    async checkSms(orderId) {
        calls.push(["check", orderId]);
        return { status: 3, sms: "123456", full_sms: "Your code is 123456" };
    },
    async cancelSms(orderId) {
        calls.push(["cancel", orderId]);
        return { success: 1 };
    },
};
const personalAccountSessionManager = {
    async requestPhoneCode(sessionId, input) {
        calls.push(["facebook-request", sessionId, input]);
    },
    async submitPhoneCode(sessionId, input) {
        calls.push(["facebook-submit", sessionId, input]);
    },
};
const manager = new SmsPoolPhoneVerificationManager({
    smsPool,
    personalAccountSessionManager,
    countryCatalog: {
        async list() { return [{ code: "US", name: "United States", aliases: [] }]; },
    },
    pollingIntervalMs: 1,
    wait: async () => {},
});

const dashboard = await manager.getDashboard("session-1");
assert.equal(dashboard.balance, 9.5);
assert.equal(dashboard.countries[0].iso, "US");
manager.start("session-1", {
    adAccountId: "act_1",
    countryId: "1",
    maxAttempts: 5,
    waitSeconds: 60,
});

for (let index = 0; index < 20; index += 1) {
    if (manager.getState("session-1").job?.status === "completed") break;
    await new Promise((resolve) => setImmediate(resolve));
}

const state = manager.getState("session-1");
assert.equal(state.job.status, "completed");
assert.equal(state.job.order.phone, "+12025550100");
assert.equal(state.job.order.code, "123456");
assert.equal(state.history.length, 1);
assert.equal(calls.find(([name]) => name === "purchase")[1].service, facebookSmsPoolService);
assert.equal(calls.find(([name]) => name === "facebook-request")[2].countryCode, "US");
assert.deepEqual(calls.find(([name]) => name === "facebook-submit")[2], { code: "123456" });

console.log("SMSPool phone verification manager tests passed");
