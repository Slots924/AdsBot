import "dotenv/config";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdsPower from "../../classes/AdsPower.js";
import checkProfileSession from "../../workflows/autoupload/checkProfileSession.js";
import { profileActions, validateProfileAction } from "../../facebook/autoupload/actions/profile/index.js";
import createTestProfileImage from "../helpers/createTestProfileImage.js";
import { BAN_TAG_ID } from "../../config.js";
import HttpActionContext from "../../facebook/autoupload/HttpActionContext.js";
import getManagePosts from "../../facebook/api-actions/posts/getManagePosts.js";

// Окремий режим читає лише результат тестової публікації та нічого не змінює.
if (process.argv.includes("--inspect-profile-2333")) {
    try {
        const adsPower = new AdsPower();
        const profile = await adsPower.getProfileByNo("2333");
        if ((profile.profile_tags ?? []).some(tag => String(tag.id) === BAN_TAG_ID)) throw new Error();
        const prepared = await checkProfileSession({ profileId: profile.profile_id, adsPower });
        if (!prepared.client) {
            console.log(JSON.stringify({ inspection: "stopped", status: prepared.result.status }));
            process.exit(1);
        }
        const context = new HttpActionContext(prepared.client.getFbData(profile.profile_id));
        const result = await prepared.client.run(() => getManagePosts({ page: context, omitPinnedPost: false }));
        const matches = (result.data?.posts ?? []).filter(post => post.message === "HTTP profile test");
        const inspection = { success: result.success, status: result.status, testPostsFound: matches.length,
            testPostsWithRequestedDate: matches.filter(post => new Date(Number(post.creationTime) * 1000).toISOString().slice(0, 10) === "2025-06-15").length };
        console.log(JSON.stringify({ inspection }));
        const reportPath = path.resolve("data/reports/autoupload-profile-2333-live.json");
        const previous = JSON.parse(await readFile(reportPath, "utf8"));
        await writeFile(reportPath, JSON.stringify({ ...previous, inspection }, null, 2));
        process.exit(result.success ? 0 : 1);
    } catch {
        console.log(JSON.stringify({ inspection: "failed" }));
        process.exit(1);
    }
}

// Одноразовий живий тест дозволеного користувачем профілю; секрети не потрапляють у звіт.
if (!process.argv.includes("--execute-profile-2333")) throw new Error("Для живого тесту потрібен прапорець --execute-profile-2333");
const reportFile = path.resolve("data/reports/autoupload-profile-2333-live.json");
try { await readFile(reportFile); throw new Error("Живий тест 2333 вже запускався. Автоматичний повтор заборонено"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const report = { profileNo: "2333", startedAt: new Date().toISOString(), actions: [] };
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
const save = async () => writeFile(reportFile, JSON.stringify(report, null, 2));
const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-live-2333-"));
try {
    const adsPower = new AdsPower();
    const profile = await adsPower.getProfileByNo("2333");
    if ((profile.profile_tags ?? []).some(tag => String(tag.id) === BAN_TAG_ID)) throw new Error("Профіль має тег BAN. Тест припинено");
    const prepared = await checkProfileSession({ profileId: profile.profile_id, adsPower });
    report.session = { status: prepared.result.status, message: prepared.result.message };
    await save();
    console.log(JSON.stringify({ stage: "session", ...report.session }));
    if (!prepared.client) throw new Error("Не вдалося підготувати активну HTTP-сесію; зміни не запускалися");
    const imagePath = path.join(directory, "neutral-http-test.png");
    await writeFile(imagePath, createTestProfileImage());
    const inputs = [
        ["avatar", { imagePath }], ["cover", { imagePath }], ["clear-posts", { confirmed: true }],
        ["publish-posts", { posts: [{ mediaPaths: [imagePath], targetDate: "2025-06-15", text: "HTTP profile test" }] }],
        ["bio", { value: "HTTP profile test" }],
        ["about", { education: "Harvard University", work: { company: "OpenAI", position: "Software Engineer" } }],
    ];
    for (const [action, input] of inputs) {
        const entry = { action, startedAt: new Date().toISOString(), state: "started" };
        report.actions.push(entry);
        await save();
        console.log(JSON.stringify({ stage: action, state: "started" }));
        const result = await profileActions[action](prepared.client.getFbData(profile.profile_id), validateProfileAction(action, input));
        Object.assign(entry, { state: "finished", finishedAt: new Date().toISOString(), result });
        await save();
        console.log(JSON.stringify({ stage: action, result }));
        if (["checkpoint", "login_required"].includes(result.sessionStatus)) {
            report.stopped = result.sessionStatus;
            break;
        }
    }
} catch (error) {
    report.error = error.safeAdsPowerMessage || (error.safeFacebookError ? error.message : "Живий тест припинено: не вдалося підготувати або завершити запити");
    console.log(JSON.stringify({ stage: "stopped", message: report.error }));
    process.exitCode = 1;
} finally {
    report.finishedAt = new Date().toISOString();
    await save();
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("adsbot-live-2333-")) throw new Error("Некоректний тимчасовий каталог");
    await rm(directory, { recursive: true, force: true });
}
