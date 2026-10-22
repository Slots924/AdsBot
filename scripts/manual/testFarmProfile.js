import "dotenv/config";
import AdsPower from "../../classes/AdsPower.js";
import executeFarmWithProfile from "../../workflows/profile/executeFarmWithProfile.js";
import configureFacebookAutomationWindow from "../../facebook/browser/configureFacebookAutomationWindow.js";
import { normalizeFarmSettings } from "../../services/farming/farmSettings.js";
import { redactString } from "../../services/logging/AppLogger.js";

// Запускається лише з явно заданим профілем; не ставить реакцій і не вступає до груп.
const profileNo = String(process.argv[2] ?? "").trim();
if (!/^\d+$/.test(profileNo)) throw new Error("Вкажіть номер тестового AdsPower-профілю");
const timeoutSeconds = Number(process.argv[3] ?? 150);
const output = console.log.bind(console);
// Приховуємо службові повідомлення наявних workflow, які можуть містити дані акаунта.
for (const method of ["log", "info", "debug", "warn", "error"]) console[method] = () => {};
const log = (stage, details = {}) => output(JSON.stringify({ stage, ...details }));

const adsPower = new AdsPower();
const settings = normalizeFarmSettings({ timeoutSeconds, workers: 1, actions: {
    feed: { enabled: true, count: 100, minSeconds: 5, maxSeconds: 9, upPercent: 20 },
} });
let postsRead = 0;
let windowVerified = false;
let launchVerified = false;
let farmStarted = false;
const start = Date.now();
const originalOpen = adsPower.openProfile.bind(adsPower);
adsPower.openProfile = (number, options) => {
    launchVerified = options.proxyDetection === true && options.restoreLastOpenedTabs === false
        && options.disableImages === false && options.browserMode === "visible";
    log("opening", { launchVerified, timeoutSeconds });
    return originalOpen(number, options);
};
const heartbeat = setInterval(() => log("waiting", { elapsedSeconds: Math.round((Date.now() - start) / 1000), farmStarted, postsRead }), 20000);
try {
    log("fetch_profile");
    const profile = await adsPower.getProfileByNo(profileNo);
    const proxyBefore = JSON.stringify(profile.user_proxy_config);
    const result = await executeFarmWithProfile({ adsPower, profile, settings, pool: [],
        onFarmStart: async () => { farmStarted = true; log("farm_started"); },
        onState: async ({ state }) => log("account_state", { state }),
        onEvent: async (event) => {
            if (event.action === "read_post" && event.status === "completed") postsRead++;
            log("event", { action: event.action, status: event.status, postsRead,
                ...(event.reason ? { reason: redactString(event.reason) } : {}) });
        },
        dependencies: { configure: async (page, options) => {
            const configured = await configureFacebookAutomationWindow(page, options);
            windowVerified = configured.applied && configured.bounds?.width === 1280 && configured.bounds?.height === 1440;
            log("window", { verified: windowVerified, width: configured.bounds?.width, height: configured.bounds?.height });
            return configured;
        } },
    });
    log("result", { ...result, reason: result.reason ? redactString(result.reason) : null,
        ...(result.cleanupError ? { cleanupError: redactString(result.cleanupError) } : {}),
        elapsedSeconds: Math.round((Date.now() - start) / 1000), postsRead });
    if (result.outcome !== "skipped") {
        const active = await adsPower.getCloudProfileStatus(profile.profile_id);
        const refreshed = await adsPower.getProfileByNo(profileNo);
        const closed = Array.isArray(active) && active.length === 0;
        const proxyUnchanged = JSON.stringify(refreshed.user_proxy_config) === proxyBefore;
        log("verification", { closed, proxyUnchanged, windowVerified, launchVerified, farmStarted, postsRead });
        process.exitCode = result.outcome === "timeout" && closed && proxyUnchanged && windowVerified && launchVerified && postsRead > 0 ? 0 : 1;
    } else process.exitCode = 1;
} catch (error) {
    log("error", { message: redactString(error.message) }); process.exitCode = 1;
} finally { clearInterval(heartbeat); }
