import { mkdir, writeFile } from "node:fs/promises";
import axios from "axios";
import createFacebookApiClients from "../../facebook/api/createFacebookApiClients.js";
import CampaignTemplateManager from "../../services/templates/CampaignTemplateManager.js";
import { buildTargeting } from "../../facebook/services/campaigns/CampaignSettings.js";
import { sanitize } from "../../services/logging/AppLogger.js";

if (!process.argv.includes("--live")) throw new Error("Для живого тесту потрібен --live");
const postArgument = process.argv.find((value) => value.startsWith("--post="));
const postId = postArgument?.slice("--post=".length) ?? "734023826464284_122183495126978547";
if (!/^\d+_\d+$/.test(postId)) throw new Error("Потрібен Post ID у форматі PageID_PostID");
const pageId = postId.split("_")[0];
const report = { startedAt: new Date().toISOString(), requests: [], objects: null };
const reportFile = `data/reports/instagram-page-backed-test-${Date.now()}.json`;
async function save() {
    await mkdir("data/reports", { recursive: true });
    await writeFile(reportFile, JSON.stringify(sanitize(report), null, 2) + "\n");
}
// Транспорт лише перевіряє проксі; URL, токени та запити формує API-клієнт.
const httpClient = { async request(config) {
    if (config.proxy !== false || !config.httpsAgent) throw new Error("Запит без проксі заблоковано");
    const url = new URL(config.url);
    if (url.hostname !== "graph.facebook.com") throw new Error("Неочікуваний хост");
    if (config.method === "post" && /\/(campaigns|adsets|ads)$/.test(url.pathname)
        && config.data.get("status") !== "PAUSED") throw new Error("Дозволено лише PAUSED");
    const entry = { method: config.method, endpoint: url.pathname, throughProxy: true };
    report.requests.push(entry);
    try {
        const response = await axios.request(config);
        entry.httpStatus = response.status;
        return response;
    } catch (error) {
        entry.failure = { code: error.code ?? null, httpStatus: error.response?.status ?? null,
            graphCode: error.response?.data?.error?.code ?? null };
        console.log(JSON.stringify({ endpoint: entry.endpoint, failure: entry.failure }));
        throw error;
    }
} };

try {
    const clients = await createFacebookApiClients({ onlyAccountKey: "account-044", httpClient });
    const api = clients.get("account-044");
    if (!api) throw new Error("API-клієнт недоступний");
    const adAccountId = "act_1424102882601557";
    const template = await new CampaignTemplateManager().get(27);
    if (!template.placements?.instagram?.length) throw new Error("Шаблон не містить Instagram placements");
    report.identityBefore = await api.getPageInstagramIdentity({ pageId });
    const pixels = await api.getAdPixels(adAccountId);
    if (pixels.length !== 1) throw new Error("Не вдалося однозначно визначити Pixel останньої спроби");
    // Лише цей екземпляр тесту пропускає вимогу окремого Instagram business account.
    // Решта перевірок збережена, а оригінальні Instagram placements повертаються в targeting.
    const preflight = api.preflightLeadCampaign.bind(api);
    api.preflightLeadCampaign = async (input) => {
        const checked = await preflight({ ...input, template: {
            ...input.template, placements: { ...input.template.placements, instagram: [] },
        } });
        return { ...checked, targeting: buildTargeting(input.template), instagramActorId: null };
    };
    report.input = { adAccountId, pageId, postId,
        templateId: 27, dailyBudget: 5, adSetCount: 1, placements: template.placements };
    console.log(JSON.stringify({ stage: "identity-before", identity: report.identityBefore }));
    const result = await api.createLeadCampaign({
        ...report.input, template, pixelId: pixels[0].id, utm: "",
        campaignName: `TEST Use Facebook Page Instagram ${new Date().toISOString()}`,
        startTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        creativeMode: "post", createPaused: true, createAdSetsPaused: true, createAdsPaused: true,
    }, async (progress) => {
        report.stage = progress.stage;
        report.objects = progress.objects;
        await save();
        console.log(JSON.stringify({ stage: progress.stage, objects: progress.objects }));
    });
    report.statuses = { campaign: result.readback.campaign.status,
        adSets: result.readback.adSets.map((x) => x.status), ads: result.readback.ads.map((x) => x.status) };
    report.creativeIdentity = await api.getAdCreativeDetails({
        creativeId: result.objects.creativeId, includeInstagramIdentity: true,
    });
    report.identityAfter = await api.getPageInstagramIdentity({ pageId });
    report.targeting = result.readback.adSets.map((item) => item.targeting);
    try {
        const previews = await api.getAdCreativePreviews({
            creativeId: result.objects.creativeId, adFormat: "INSTAGRAM_STANDARD",
        });
        report.instagramPreview = { count: previews.length, hasHtml: previews.some((item) => Boolean(item.body)) };
    } catch (error) {
        report.instagramPreview = sanitize({ error: error.message, code: error.code,
            graphCode: error.graphCode, graphSubcode: error.graphSubcode });
    }
    report.warnings = result.readback.warnings;
    report.status = "complete";
    console.log(JSON.stringify({ status: report.status, statuses: report.statuses,
        instagramUserId: report.creativeIdentity.instagram_user_id ?? null,
        identityAfter: report.identityAfter, instagramPreview: report.instagramPreview,
        targeting: report.targeting }));
} catch (error) {
    report.status = "failed";
    report.objects = error.createdObjects ?? report.objects;
    report.error = sanitize({ message: error.message, code: error.code, stage: error.stage,
        graphCode: error.graphCode, graphSubcode: error.graphSubcode });
    console.log(JSON.stringify({ status: report.status, error: report.error, objects: report.objects }));
    process.exitCode = 1;
} finally {
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ reportFile }));
}
