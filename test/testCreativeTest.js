import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCreativeTest, prepareCreativeTest, validateCreativeTest, normalizeCreativeTestOptions, extractCreativeUrls } from "../services/creatives/creativeTest.js";
import prepareCreativeForCampaign from "../services/creatives/prepareCreativeForCampaign.js";
import createLeadCampaign from "../facebook/workflows/createLeadCampaign.js";
import preflightLeadCampaign from "../facebook/workflows/preflightLeadCampaign.js";
import CampaignCreationJournal from "../services/campaigns/CampaignCreationJournal.js";
import FacebookBackendService from "../facebook/services/FacebookBackendService.js";

const url = "https://example.test/offer?a=1";
const sourceText = `Перший\nрядок\r\n \r\nДругий\r\n\r\n\r\nТретій ${url}`;
const creativeTest = buildCreativeTest({ sourceText, siteUrl: url, creativeName: "202" });
const template = { countryCodes: ["US"], ageMin: 18, ageMax: 65, advantageAudience: true, placements: { facebook: ["story"], instagram: ["stream"] } };
const options = { campaignName: "Ручна назва", adAccountId: "act_1", pageId: "10", pixelId: "30", startTime: "2027-01-01T00:00:00Z", dailyBudget: 5, adSetCount: 99, template, creativeTest, imagePath: "test.jpg", createPaused: false, createAdSetsPaused: false, createAdsPaused: false, adCreative: { image: { buffer: Buffer.from("test") } } };

test("Обидва режими охоплюють усі абзаци та зберігають перший рядок", () => {
    assert.equal(creativeTest.variants.length, 3);
    assert.equal(creativeTest.variants[0].text, `Перший\nрядок\n${url}`);
    assert.equal(creativeTest.variants[1].text, `Перший\nрядок\n\nДругий\n${url}`);
    assert.equal(creativeTest.variants[2].text.match(/https:/g).length, 1);
    assert.equal(creativeTest.variants[2].label, "Абзаци 1–3");
    const individual = buildCreativeTest({ sourceText, siteUrl: url, mode: "individual" });
    assert.equal(individual.variants[1].text, `Другий\n${url}`);
    assert.equal(individual.variants[1].label, "Абзац 2");
    assert.equal(buildCreativeTest({ sourceText: "\n Один \n", siteUrl: url }).variants.length, 1);
    assert.throws(() => buildCreativeTest({ sourceText: " \n\n ", siteUrl: url }));
    assert.throws(() => buildCreativeTest({ sourceText: "Текст", siteUrl: "ftp://example.test" }));
    assert.deepEqual(extractCreativeUrls(`(${url}). ${url}`), [url]);
    assert.equal(buildCreativeTest({ sourceText: `${url}/other`, siteUrl: url }).variants[0].text, `${url}/other\n${url}`);
});

test("Власний текст: автоматичний URL, вибір кількох, шрифт без зміни URL", async () => {
    const noGeneration = () => { throw new Error("Генерація не повинна викликатися"); };
    await assert.rejects(prepareCreativeTest({ sourceMode: "manual", manualCreativeText: " \n " }, noGeneration), /Введіть власний текст/);
    await assert.rejects(prepareCreativeTest({ manualCreativeText: "Без посилання" }, noGeneration));
    const result = await prepareCreativeTest({ manualCreativeText: `Текст ${url}`, useCreativeFont: true }, noGeneration);
    assert.equal(result.creativeTest.siteUrl, url);
    assert.ok(result.creativeTest.sourceText.includes("\u034f"));
    assert.ok(result.creativeTest.sourceText.includes(url));
    const text = `${url}\n\nhttps://other.test/`;
    assert.equal((await prepareCreativeTest({ manualCreativeText: text }, noGeneration)).selectionRequired, true);
    const selected = await prepareCreativeTest({ manualCreativeText: text, siteUrl: "https://other.test/", mode: "individual" }, noGeneration);
    assert.ok(selected.creativeTest.variants[0].text.endsWith("https://other.test/"));
    await assert.rejects(prepareCreativeTest({ manualCreativeText: text, siteUrl: "https://missing.test/" }, noGeneration));
});

test("Бібліотечний текст готується один раз і фіксується; підміна варіантів відхиляється", async () => {
    let calls = 0;
    const library = { creative: "Заголовок\n\nТекст <LINK>", comments: [] };
    const { creativeTest: prepared } = await prepareCreativeTest({ geo: "US", language: "DE", creativeName: "202", siteUrl: url }, async input => {
        calls++;
        assert.equal(input.geo, "DE");
        return prepareCreativeForCampaign({ creative: library, siteUrl: input.siteUrl });
    });
    library.creative = "Змінений файл";
    assert.equal(calls, 1);
    assert.equal(validateCreativeTest(prepared).variants[0].text, `Заголовок\n${url}`);
    const tampered = structuredClone(prepared);
    tampered.variants[0].text = "Інший текст";
    assert.throws(() => validateCreativeTest(tampered), { code: "CREATIVE_TEST_INVALID" });
    const normalized = normalizeCreativeTestOptions(options);
    assert.equal(normalized.adSetCount, 1);
    assert.equal(normalized.template.advantageAudience, false);
    assert.deepEqual(normalized.template.placements, { facebook: ["feed"], instagram: [] });
    assert.equal(template.advantageAudience, true);
    assert.match(normalized.campaignName, /^Тест креативу.*Creo_202.*Ручна назва$/);
    assert.equal(normalizeCreativeTestOptions(normalized).campaignName, normalized.campaignName);
});

function operations(fail = false) {
    const written = { campaigns: [], creatives: [], adSets: [], ads: [], uploads: 0, activations: [] };
    return {
        written,
        preflight: async input => preflightLeadCampaign(input, {
            getPermissions: async () => ({ granted: ["ads_management"] }),
            getAccount: async () => ({ account_status: 1, currency: "USD", timezone_name: "UTC" }),
            getPage: async () => ({ name: "Test Page" }),
            getPost: async () => { throw new Error("Не можна читати пости"); },
            getInstagramAccount: async () => { throw new Error("Не можна читати Instagram"); },
            getPixels: async () => [{ id: "30" }], validateCampaign: async () => ({}),
        }),
        createCampaign: async (id, fields) => { written.campaigns.push(fields); return { id: "100" }; },
        uploadImage: async () => { written.uploads++; return "image-hash"; },
        createCreative: async (id, fields, settings) => {
            if (settings?.validateOnly) return {};
            written.creatives.push(fields); return { id: String(200 + written.creatives.length) };
        },
        createAdSet: async (id, fields, settings) => {
            if (settings?.validateOnly) return {};
            written.adSets.push(fields); return { id: "300" };
        },
        createAd: async (id, fields, settings) => {
            if (settings?.validateOnly) return {};
            if (fail && written.ads.length === 1) throw new Error("Помилка створення");
            written.ads.push(fields); return { id: String(400 + written.ads.length) };
        },
        activate: async id => { written.activations.push(id); },
        readback: async objects => ({ creative: {}, creatives: written.creatives, adSets: written.adSets, ads: written.ads }),
    };
}

test("Нові оголошення: 1 кампанія, 1 адсет, N текстів, одне зображення", async () => {
    for (const mode of ["cumulative", "individual"]) {
        const mock = operations();
        const input = { ...options, creativeTest: buildCreativeTest({ sourceText, siteUrl: url, mode }) };
        const events = [];
        const result = await createLeadCampaign(input, event => events.push(event), mock);
        assert.equal(mock.written.campaigns.length, 1);
        assert.equal(mock.written.adSets.length, 1);
        assert.equal(mock.written.ads.length, 3);
        assert.equal(mock.written.uploads, 1);
        assert.deepEqual(mock.written.activations, ["100"]);
        assert.equal(result.objects.creatives.length, 3);
        assert.equal(events.at(-1).stage, "complete");
        for (const [index, fields] of mock.written.creatives.entries()) {
            assert.equal(fields.object_story_id, undefined);
            assert.equal(fields.object_story_spec.link_data.message, input.creativeTest.variants[index].text);
            assert.equal(fields.object_story_spec.link_data.image_hash, "image-hash");
            assert.equal(fields.object_story_spec.link_data.link, url);
            assert.equal(fields.object_story_spec.link_data.name, "example.test");
            assert.equal(fields.object_story_spec.link_data.call_to_action, undefined);
            assert.ok(mock.written.ads[index].name.includes(input.creativeTest.variants[index].label));
        }
    }
});

test("Часткова помилка зберігає ID та абзац і не активує кампанію", async () => {
    const mock = operations(true);
    await assert.rejects(createLeadCampaign(options, undefined, mock), error => {
        assert.match(error.message, /Абзаци 1–2/);
        assert.equal(error.createdObjects.ads.length, 1);
        assert.equal(error.createdObjects.creatives.length, 3);
        assert.equal(error.stage, "ad");
        return true;
    });
    assert.deepEqual(mock.written.activations, []);
});

test("Backend запускає зафіксований тест без отримання бібліотеки та публікацій", async () => {
    let imageReads = 0;
    const mock = operations();
    const backend = new FacebookBackendService({
        facebookApiClients: new Map([["test", { createLeadCampaign: (input, progress) => createLeadCampaign(input, progress, mock) }]]),
        creativeManager: { getCreative: () => { throw new Error("Не можна генерувати повторно"); } },
        imageLoader: async () => { imageReads++; return { buffer: Buffer.from("test") }; },
        publishPagePostFn: () => { throw new Error("Не можна публікувати"); },
    });
    await backend.createLeadCampaign("test", options);
    assert.equal(imageReads, 1);
    assert.equal(mock.written.ads.length, 3);
});

test("Журнал зберігає тест і коректний прогрес після повторного читання", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "creative-test-"));
    try {
        const jobsFile = path.join(directory, "jobs.json");
        const journal = new CampaignCreationJournal({ jobsFile });
        const job = await journal.create(options);
        assert.equal(job.input.adSetCount, 1);
        assert.equal(job.total, 9);
        const loaded = await new CampaignCreationJournal({ jobsFile }).get(job.id);
        assert.deepEqual(loaded.input.creativeTest, creativeTest);
        assert.equal(loaded.input.creativeMode, "image");
    } finally { await rm(directory, { recursive: true, force: true }); }
});
