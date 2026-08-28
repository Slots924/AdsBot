import "dotenv/config";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

import createFacebookApiClients
    from "../../facebook/api/createFacebookApiClients.js";


const [accountKey, creativeId, outputPath = "artifacts/ad-preview.png"]
    = process.argv.slice(2);
if (!accountKey || !/^\d+$/.test(String(creativeId ?? ""))) {
    throw new Error(
        "Використання: node scripts/manual/screenshotAdPreview.js <accountKey> <creativeId> [outputPath]"
    );
}

const clients = await createFacebookApiClients();
const api = clients.get(accountKey);
if (!api) {
    throw new Error(`Facebook API-клієнт "${accountKey}" не знайдено`);
}

const previews = await api.getAdCreativePreviews({ creativeId });
const body = String(previews[0]?.body ?? "");
const sourceMatch = body.match(/src=["']([^"']+)/i);
const previewUrl = sourceMatch?.[1]?.replaceAll("&amp;", "&");
if (!previewUrl) {
    throw new Error("Meta не повернула URL рекламного прев'ю");
}

const absoluteOutput = path.resolve(outputPath);
await mkdir(path.dirname(absoluteOutput), { recursive: true });
const browser = await puppeteer.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    userDataDir: path.resolve("artifacts", `preview-profile-${process.pid}`),
    args: ["--disable-gpu", "--no-first-run"],
});

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 1200, deviceScaleFactor: 1 });
    await page.goto(previewUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.screenshot({ path: absoluteOutput, fullPage: true });
    console.log(absoluteOutput);
} finally {
    await browser.close();
}
