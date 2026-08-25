import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import saveCommentAccountSetupReport, {
    buildCommentAccountSetupMarkdown,
} from "../services/reports/saveCommentAccountSetupReport.js";


const report = {
    startedAt: "2026-08-25T10:00:00.000Z",
    finishedAt: "2026-08-25T10:05:00.000Z",
    geo: "DE",
    profileNos: ["10", "11", "12"],
    personaCount: 2,
    photosDirectory: "C:/photos",
    concurrency: 2,
    browserMode: "visible",
    fatalError: null,
    profiles: [
        {
            profileNo: "10",
            outcome: "success",
            persona: {
                gender: "male",
                firstName: "Holger",
                lastName: "Steinhof",
            },
            adsPowerName: "m_Holger Steinhof",
            steps: {
                name: { ok: true, detail: "змінено на Holger Steinhof" },
                avatar: { ok: true, detail: "1.jpg" },
                cover: { ok: true, detail: "2.jpg" },
                deletePosts: { ok: true, detail: "старі пости видалено" },
                posts: { ok: true, detail: "1 фото, дати 2023-04-01" },
                about: { ok: true, detail: "bio; Mechaniker @ Firma; school" },
                genderTag: { ok: true, detail: "Man" },
                adsPowerRename: { ok: true, detail: "m_Holger Steinhof" },
                photoFolderRename: {
                    ok: true,
                    detail: "pack-a → AdsPower_10",
                },
            },
        },
        {
            profileNo: "11",
            outcome: "completed_with_error",
            persona: {
                gender: "female",
                firstName: "Meike",
                lastName: "Vogler",
            },
            adsPowerName: "f_Meike Vogler",
            steps: {
                name: { ok: true, detail: "змінено на Meike Vogler" },
                avatar: { ok: false, error: "INVALID_IMAGE" },
                cover: { skipped: true, reason: "Немає фото" },
                deletePosts: { ok: true },
                posts: { skipped: true, reason: "Немає фото" },
                about: { ok: true },
                genderTag: { ok: true, detail: "Woman" },
                adsPowerRename: { ok: true, detail: "f_Meike Vogler" },
                photoFolderRename: { skipped: true, reason: "Немає папки фото" },
            },
        },
        {
            profileNo: "12",
            outcome: "failed",
            error: "WHATSAPP_REQUIRED",
            persona: {
                gender: "male",
                firstName: "Lars",
                lastName: "Holtz",
            },
            steps: {
                name: { ok: false, error: "WHATSAPP_REQUIRED" },
            },
        },
        {
            profileNo: "13",
            outcome: "skipped",
            skipReason: "Профіль має тег Change Name Error",
        },
    ],
};

const markdown = buildCommentAccountSetupMarkdown(report);
assert.match(markdown, /Успішно \| 1/);
assert.match(markdown, /Завершено з помилкою \| 1/);
assert.match(markdown, /Не вдалося \| 1/);
assert.match(markdown, /Пропущено \| 1/);
assert.match(markdown, /Профіль 10 — успішно/);
assert.match(markdown, /Профіль 11 — завершено з помилкою/);
assert.match(markdown, /Аватар: не вдалося — INVALID_IMAGE/);
assert.match(markdown, /Профіль має тег Change Name Error/);

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-account-report-"));
try {
    const reportPath = await saveCommentAccountSetupReport(report, directory);
    const saved = await readFile(reportPath, "utf8");
    assert.equal(saved, markdown);
    assert.match(path.basename(reportPath), /^comment-account-setup-report_/);
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Перевірка звіту оформлення акаунтів пройшла успішно");
