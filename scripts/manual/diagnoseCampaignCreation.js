import { readFile, writeFile, mkdir } from "node:fs/promises";
import axios from "axios";
import createFacebookApiClients from "../../facebook/api/createFacebookApiClients.js";
import CampaignTemplateManager from "../../services/templates/CampaignTemplateManager.js";
import { sanitize } from "../../services/logging/AppLogger.js";
import { summarizeGraphResponse } from "../../facebook/api/graphDiagnostics.js";

const jobId = process.argv[2];
if (!jobId || !process.argv.includes("--live")) {
    throw new Error("Вкажіть ID збереженої спроби та --live для реального створення кампанії");
}

const store = JSON.parse(await readFile("./data/campaign-creation-jobs.json", "utf8"));
const job = store.jobs.find((item) => item.id === jobId);
if (!job) throw new Error("Збережену спробу не знайдено");
if (job.input.createPaused !== true) {
    throw new Error("Діагностика дозволяє лише кампанію, створену на паузі");
}

const matrixMode = process.argv.includes("--dsa-matrix");
let report = { jobId, startedAt: new Date().toISOString(), requests: [], objects: null };
const caseReports = [];
const reportFile = `./data/reports/campaign-diagnostic-${Date.now()}.json`;

function reportSnapshot() {
    return matrixMode ? { jobId, cases: caseReports.map((item) => sanitize(item)) } : sanitize(report);
}

function summarizeResponse(response) {
    const body = response.data;
    const object = body && typeof body === "object" ? body : {};
    return {
        ...summarizeGraphResponse(response),
        configuredStatus: object.status ?? null,
        hasBeneficiary: Boolean(object.dsa_beneficiary),
        hasPayor: Boolean(object.dsa_payor),
    };
}

const httpClient = {
    async request(config) {
        // Фабрика має передати агент саме проксі цього API-клієнта.
        if (config.proxy !== false || !config.httpsAgent) {
            throw new Error("Запит без proxy agent заблоковано");
        }
        const url = new URL(config.url);
        if (url.hostname !== "graph.facebook.com") {
            throw new Error("Неочікуваний хост діагностичного запиту");
        }
        const entry = {
            method: config.method,
            endpoint: url.pathname,
            throughProxy: true,
            validateOnly: config.data instanceof URLSearchParams
                && config.data.get("execution_options")?.includes("validate_only") === true,
        };
        if (config.method === "post" && url.pathname.endsWith("/ads")) {
            entry.adRequest = Object.fromEntries([
                "name", "adset_id", "creative", "status", "execution_options",
            ].map((key) => [key, config.data.get(key)]));
        }
        if (config.method === "post" && url.pathname.endsWith("/adsets")) {
            entry.adSetRequest = {
                status: config.data.get("status"),
                hasBeneficiary: config.data.has("dsa_beneficiary"),
                hasPayor: config.data.has("dsa_payor"),
            };
        }
        report.requests.push(entry);
        try {
            const response = await axios.request(config);
            // Зберігаємо лише структуру відповіді та службові поля без токенів і cookie.
            entry.response = summarizeResponse(response);
            if (config.method === "post") console.log(JSON.stringify(entry));
            return response;
        } catch (error) {
            entry.failure = error.response
                ? summarizeResponse(error.response)
                : { code: error.code ?? null, hasResponse: false };
            console.log(JSON.stringify({ endpoint: entry.endpoint, failure: entry.failure }));
            throw error;
        }
    },
};

try {
    const template = await new CampaignTemplateManager().get(job.input.templateId);
    const clients = await createFacebookApiClients({ onlyAccountKey: job.input.accountKey, httpClient });
    const api = clients.get(job.input.accountKey);
    if (!api) throw new Error("API-клієнт недоступний");
    const onProgress = async (progress) => {
        report.stage = progress.stage;
        report.objects = progress.objects;
        console.log(JSON.stringify({ stage: progress.stage, index: progress.index ?? null }));
        if (["campaign", "creative", "adset", "ad"].includes(progress.stage)) {
            const ids = [
                progress.objects.campaignId,
                ...(progress.objects.creatives ?? []).map((item) => item.id),
                ...progress.objects.adSets.map((item) => item.id),
                ...progress.objects.ads.map((item) => item.id),
            ];
            if (ids.some((id) => !id)) {
                throw Object.assign(new Error("Створення повернуло відповідь без ID; діагностику зупинено"), {
                    code: "CAMPAIGN_DIAGNOSTIC_ID_MISSING",
                });
            }
        }
    };
    const cases = matrixMode ? [
        { name: "US", countries: ["US"], omitDsa: true },
        { name: "DE", countries: ["DE"], omitDsa: false },
        { name: "US+DE", countries: ["US", "DE"], omitDsa: false },
    ] : [{ name: "original", countries: template.countryCodes, omitDsa: false }];
    for (const testCase of cases) {
        if (matrixMode) {
            report = {
                jobId, case: testCase.name, countries: testCase.countries,
                omitDsa: testCase.omitDsa, startedAt: new Date().toISOString(),
                requests: [], objects: null,
            };
            caseReports.push(report);
        }
        const testTemplate = {
            ...template,
            countryCodes: testCase.countries,
            ...(testCase.omitDsa ? { dsaBeneficiary: "", dsaPayor: "" } : {}),
        };
        const input = {
            ...job.input,
            template: testTemplate,
            ...(matrixMode ? {
                campaignName: `DSA TEST ${testCase.name} ${new Date().toISOString()}`,
                adSetCount: 1,
                createPaused: true,
                createAdSetsPaused: true,
                createAdsPaused: true,
            } : {}),
        };
        console.log(JSON.stringify({ case: testCase.name, countries: testCase.countries, omitDsa: testCase.omitDsa }));
        try {
            const result = await api.createLeadCampaign(input, onProgress);
            report.objects = result.objects;
            report.status = "complete";
            report.dsa = {
                required: result.preflight.dsa?.requiredForEurope ?? false,
                resolved: Boolean(result.preflight.dsa),
                sent: report.requests.some((entry) => entry.adSetRequest?.hasBeneficiary),
                readback: result.readback.adSets.map((adSet) => ({
                    id: adSet.id,
                    status: adSet.status,
                    hasBeneficiary: Boolean(adSet.dsa_beneficiary),
                    hasPayor: Boolean(adSet.dsa_payor),
                    beneficiaryMatches: result.preflight.dsa
                        ? adSet.dsa_beneficiary === result.preflight.dsa.beneficiary : null,
                    payorMatches: result.preflight.dsa
                        ? adSet.dsa_payor === result.preflight.dsa.payor : null,
                })),
            };
            report.warnings = result.readback.warnings;
            report.statuses = {
                campaign: result.readback.campaign.status,
                adSets: result.readback.adSets.map((item) => item.status),
                ads: result.readback.ads.map((item) => item.status),
            };
            console.log(JSON.stringify({ case: testCase.name, status: report.status, dsa: report.dsa, statuses: report.statuses, warnings: report.warnings }));
        } catch (error) {
            report.status = "failed";
            report.objects = error.createdObjects ?? report.objects;
            report.error = sanitize({ message: error.message, code: error.code, stage: error.stage, graphCode: error.graphCode, graphSubcode: error.graphSubcode });
            console.log(JSON.stringify({ case: testCase.name, error: report.error }));
            process.exitCode = 1;
            if (!matrixMode) throw error;
        } finally {
            report.finishedAt = new Date().toISOString();
            // Проміжний звіт зберігає ID створених об’єктів навіть при перериванні наступного тесту.
            await mkdir("./data/reports", { recursive: true });
            await writeFile(reportFile, JSON.stringify(reportSnapshot(), null, 2) + "\n", "utf8");
        }
    }
} catch (error) {
    report.status = "failed";
    report.error = sanitize({
        message: error.message,
        code: error.code ?? null,
        stage: error.stage ?? report.stage,
        itemIndex: error.itemIndex ?? null,
        graphCode: error.graphCode ?? null,
        graphSubcode: error.graphSubcode ?? null,
    });
    report.objects = error.createdObjects ?? report.objects;
    console.log(JSON.stringify(report.error));
    process.exitCode = 1;
} finally {
    report.finishedAt = new Date().toISOString();
    await mkdir("./data/reports", { recursive: true });
    await writeFile(reportFile, JSON.stringify(reportSnapshot(), null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ reportFile, status: report.status }));
}
