import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import AdsPower from "../../classes/AdsPower.js";
import checkProfileSession from "../../workflows/autoupload/checkProfileSession.js";
import resolveCommentTarget from "../../services/autoupload/resolveCommentTarget.js";
import createComment from "../../facebook/autoupload/actions/comments/createComment.js";
import { withHttpWorkflow } from "../../services/reports/HttpExchangeTrace.js";

// Повторний запуск не надсилає mutation, якщо спроба вже була зафіксована.
if (!process.argv.includes("--execute-profile-2238")) throw new Error("Потрібен прапорець --execute-profile-2238");
const reportFile = path.resolve("data/reports/http-comment-2238-live.json");
try { await readFile(reportFile); throw new Error("Тест уже запускався; автоматичний повтор заборонено"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify({ state: "started", startedAt: new Date().toISOString() }), { flag: "wx" });
try {
    const report = await withHttpWorkflow("testHttpComment", async () => {
        const adsPower = new AdsPower();
        const profile = await adsPower.getProfileByNo("2238");
        console.log("Отримуємо HTTP-сесію Facebook без Ads Manager");
        const prepared = await checkProfileSession({ profileId: profile.profile_id, profile, adsPower });
        if (!prepared.client) return { success: false, stage: "session", message: prepared.result.message };
        const target = resolveCommentTarget("https://www.facebook.com/permalink.php?story_fbid=pfbid09AkGNQYbacuBJimMWpCYaNWYouwES95yLk3TyJwLdhRtSg8NfrUbkqQ4VqBtKbegl&id=61595003267470");
        console.log("Сесію отримано; надсилаємо один HTTP-коментар");
        const result = await createComment(prepared.client.getFbData(profile.profile_id), {
            feedbackId: target.feedbackId, text: "Lovely photo! Thanks for sharing.",
        });
        return { ...result, storyId: target.storyId };
    }, { metadata: { profileNo: "2238" } });
    await writeFile(reportFile, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ success: report.success, outcome: report.outcome, code: report.code,
        message: report.message, commentId: report.commentId, legacyCommentId: report.legacyCommentId,
        commentFeedbackId: report.commentFeedbackId, httpStatus: report.httpStatus, httpHistory: report.httpHistory }));
    if (!report.success) process.exitCode = 1;
} catch (error) {
    const report = { success: false, message: "HTTP-тест припинено", code: error.safeFacebookError ? error.code : null, httpHistory: error.httpHistory };
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    process.exitCode = 1;
}
