import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import AppLogger from "../services/logging/AppLogger.js";
import { configureRuntimeLogger } from "../services/logging/runtimeLogger.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-graph-diagnostics-"));
const logger = new AppLogger({ logsDirectory: directory, level: "debug" });
await logger.initialize();
configureRuntimeLogger(logger);

function client(mode) {
    const calls = [];
    const api = new FacebookGraphApi({
        accountKey: "mock", accessToken: "EAAcredentialSecret", cookie: "cookie-secret", userAgent: "agent-secret",
        proxyHttpClient: {
            async request(config, settings) {
                const endpoint = new URL(config.url).pathname.replace("/v26.0", "");
                const validateOnly = config.data?.get("execution_options")?.includes("validate_only") === true;
                calls.push({ endpoint, validateOnly, settings });
                const response = { status: 200, headers: { "content-type": "application/json", "x-fb-trace-id": "trace-mock" } };
                if (endpoint.endsWith("/ads") && config.method === "post") {
                    if ((mode === "auth-validation" && validateOnly) || (mode === "auth-creation" && !validateOnly)) {
                        return { ...response, data: { error: {
                            code: 31, error_subcode: 3858385, type: "FacebookApiException",
                            message: "Pending action", error_user_title: "Please authenticate your account",
                            error_user_msg: "Authenticate cookie=error-secret EAAerrorSecret", fbtrace_id: "error-trace",
                        } } };
                    }
                    if (mode === "http-error" && !validateOnly) {
                        throw Object.assign(new Error("HTTP error"), { response: { ...response, status: 400, data: { error: { code: 100, message: "beneficiary rejected" } } } });
                    }
                    if (mode === "missing-id" && !validateOnly) return { ...response, data: { success: true } };
                    if (mode === "unknown" && !validateOnly) throw Object.assign(new Error("Connection lost"), { code: "PROXY_REQUEST_OUTCOME_UNKNOWN" });
                }
                if (validateOnly) return { ...response, data: { success: true } };
                if (config.method === "post") {
                    const id = endpoint.endsWith("/campaigns") ? "100" : endpoint.endsWith("/adcreatives") ? "200" : endpoint.endsWith("/adsets") ? "300" : "400";
                    return { ...response, data: { id, ...(mode === "warnings" ? { warnings: [{ code: 99, message: "Recommendation" }] } : {}) } };
                }
                return { ...response, data: { id: endpoint.slice(1), status: "PAUSED", access_token: "EAAresponseSecret", name: "profile-name-secret" } };
            },
        },
    });
    api.preflightLeadCampaign = async () => ({ adAccountId: "act_1", pageId: "10", postId: "10_20", pixel: { id: "30" }, targeting: {}, dailyBudgetMinor: "500", startTime: "2026-10-11T08:00:00Z", dsa: null });
    return { api, calls };
}

const input = { campaignName: "Test", adSetCount: 2, template: { shareAdSetBudget: false, disableCreativeEnhancements: false, disableMultiAdvertiserAds: false }, createPaused: true };
try {
    for (const mode of ["auth-validation", "auth-creation", "http-error", "missing-id", "unknown"]) {
        const { api, calls } = client(mode);
        await logger.runWithContext({ taskId: "task-mock", jobId: "job-mock" }, () => assert.rejects(api.createLeadCampaign(input), (error) => {
            assert.equal(error.stage, "ad");
            assert.equal(error.itemIndex, 0);
            assert.equal(error.createdObjects.campaignId, "100");
            assert.equal(error.createdObjects.adSets.length, 1);
            assert.equal(error.createdObjects.ads.length, 0);
            assert.equal(error.retryable, false);
            assert.ok(error.requestId);
            if (mode.startsWith("auth")) {
                assert.equal(error.code, "FACEBOOK_ACCOUNT_AUTH_REQUIRED");
                assert.equal(error.actionRequired, "authenticate_account");
                assert.equal(error.graphCode, 31);
                assert.equal(error.httpStatus, 200);
                assert.equal(error.traceId, "error-trace");
                assert.match(error.message, /Підтвердіть акаунт/);
            } else if (mode === "http-error") {
                assert.equal(error.code, "CAMPAIGN_DSA_BENEFICIARY_REJECTED");
                assert.equal(error.httpStatus, 400);
            } else {
                assert.equal(error.code, "FACEBOOK_WRITE_OUTCOME_UNKNOWN");
                assert.equal(error.outcomeUnknown, true);
            }
            return true;
        }));
        assert.equal(calls.filter((call) => call.endpoint.endsWith("/adsets") && !call.validateOnly).length, 1);
        assert.equal(calls.filter((call) => call.endpoint.endsWith("/ads") && !call.validateOnly).length, mode === "auth-validation" ? 0 : 1);
        assert.equal(calls.some((call) => call.endpoint.includes("undefined")), false);
        assert.equal(calls.filter((call) => call.endpoint.endsWith("/ads")).every((call) => call.settings.retryOnConnectionError === false), true);
    }
    const { api } = client("warnings");
    const result = await api.createLeadCampaign({ ...input, adSetCount: 1 });
    assert.equal(result.objects.ads.length, 1);
    assert.ok(result.readback.warnings.includes("Meta: Recommendation"));

    const records = (await logger.list({ limit: 100 })).items;
    const failed = records.find((entry) => entry.event === "graph.request.failed" && entry.fields.graphCode === 31);
    assert.equal(failed.context.taskId, "task-mock");
    assert.equal(failed.fields.response.httpStatus, 200);
    assert.equal(failed.fields.response.error.error_subcode, 3858385);
    assert.equal(failed.fields.actionRequired, "authenticate_account");
    assert.ok(records.some((entry) => entry.fields.result === "success_with_warnings"));
    const text = JSON.stringify(records);
    for (const secret of ["EAAcredentialSecret", "cookie-secret", "agent-secret", "EAAresponseSecret", "profile-name-secret", "EAAerrorSecret", "error-secret"]) {
        assert.equal(text.includes(secret), false, secret);
    }
    logger.setLevel("info");
    await client("success").api.createLeadCampaign({ ...input, adSetCount: 1 });
    assert.ok((await logger.list({ levels: ["info"], limit: 100 })).items.some((entry) => entry.event === "graph.response"));
} finally {
    await logger.flush();
    configureRuntimeLogger(null);
    await rm(directory, { recursive: true, force: true });
}
console.log("Перевірки Graph API HTTP 200 errors, ID, діагностики й секретів пройшли");
