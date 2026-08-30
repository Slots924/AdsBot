import "dotenv/config";

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import createFacebookApiClients
    from "../../facebook/api/createFacebookApiClients.js";

const accountKey = "fp_hub";
const pageId = "122454390947141";
// Фото з посилання користувача. Додаємо його навіть якщо snapshot не поверне його.
const explicitlyRequestedPhotoIds = ["122110966382020023"];

function timestamp() {
    return new Date().toISOString();
}

function serializeError(error) {
    return {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        code: error?.code ?? null,
        httpStatus: error?.httpStatus ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
        graphType: error?.graphType ?? null,
        stack: error?.stack ?? null,
    };
}

async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    await mkdir(directory, { recursive: true });
    const stamp = report.finishedAt.replace(/[:.]/g, "-");
    const base = path.join(directory, `facebook-page-api-cleanup-${stamp}`);
    const reportPath = `${base}.json`;
    const logPath = `${base}.jsonl`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await appendFile(logPath, `${report.log.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    return { reportPath, logPath };
}

async function run() {
    const startedAt = timestamp();
    const log = [];
    const results = [];
    const writeLog = (level, message, details = {}) => {
        const entry = { at: timestamp(), level, message, ...details };
        log.push(entry);
        console.log(JSON.stringify(entry));
    };

    writeLog("info", "Початок повного очищення fanpage", {
        accountKey,
        pageId,
        explicitlyRequestedPhotoIds,
        note: "Видаляються всі пости та фотографії зі snapshot",
    });

    const clients = await createFacebookApiClients();
    const client = clients.get(accountKey);
    if (!client) throw new Error(`Facebook-акаунт "${accountKey}" не знайдено`);

    const snapshot = await client.getPageRebuildSnapshot({ pageId });
    const postIds = [...new Set((snapshot.posts ?? [])
        .map((post) => String(post.id ?? "").trim()).filter(Boolean))];
    const photoIds = [...new Set([
        ...(snapshot.photos ?? []).map((photo) => String(photo.id ?? "").trim()),
        ...explicitlyRequestedPhotoIds,
    ].filter(Boolean))];

    writeLog("info", "Отримано список об'єктів для видалення", {
        posts: postIds.length,
        photos: photoIds.length,
        postIds,
        photoIds,
    });

    // Спочатку видаляємо пости, потім окремі фото та фото-об'єкти.
    const targets = [
        ...postIds.map((objectId) => ({ type: "post", objectId })),
        ...photoIds.map((objectId) => ({ type: "photo", objectId })),
    ];
    for (const target of targets) {
        const item = { ...target, startedAt: timestamp(), success: false, error: null };
        try {
            const deleted = await client.deletePageObject({ pageId, objectId: target.objectId });
            item.success = deleted === true;
            writeLog("info", "Об'єкт видалено", target);
        } catch (error) {
            item.error = serializeError(error);
            writeLog("error", "Не вдалося видалити об'єкт", { ...target, error: item.error });
        }
        item.finishedAt = timestamp();
        results.push(item);
    }

    const failed = results.filter((item) => !item.success);
    const report = {
        title: "Повне очищення Facebook fanpage",
        accountKey,
        pageId,
        startedAt,
        finishedAt: timestamp(),
        snapshotSummary: { posts: postIds.length, photos: photoIds.length },
        deleted: results.filter((item) => item.success).length,
        failed: failed.length,
        success: failed.length === 0,
        results,
        log,
    };
    const paths = await saveReport(report);
    console.log(JSON.stringify({ ...paths, success: report.success }));
    if (!report.success) process.exitCode = 1;
}

run().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", error: serializeError(error) }));
    process.exitCode = 1;
});
