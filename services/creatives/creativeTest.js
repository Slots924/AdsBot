import applyCreativeFont from "./applyCreativeFont.js";

function invalid(message) {
    return Object.assign(new Error(message), { code: "CREATIVE_TEST_INVALID" });
}

export function validateTestUrl(value) {
    const text = String(value ?? "").trim();
    try {
        if (!["http:", "https:"].includes(new URL(text).protocol)) throw invalid("");
    } catch {
        throw invalid("Вкажіть коректне HTTP/HTTPS-посилання для тесту");
    }
    return text;
}

export function extractCreativeUrls(text) {
    return [...new Set((String(text ?? "").match(/https?:\/\/[^\s<>"'`]+/giu) ?? [])
        .map(value => value.replace(/[.,;!?)\]}]+$/u, ""))
        .filter(value => { try { validateTestUrl(value); return true; } catch { return false; } }))];
}

export function buildCreativeTest({ sourceText, siteUrl, mode = "cumulative", creativeName = "" }) {
    if (!["cumulative", "individual"].includes(mode)) throw invalid("Невідомий режим тестування");
    const normalizedText = String(sourceText ?? "").replace(/\r\n?/g, "\n").trim();
    const paragraphs = normalizedText.split(/\n[\t ]*\n(?:[\t ]*\n)*/u).map(value => value.trim()).filter(Boolean);
    if (!paragraphs.length) throw invalid("Креатив не містить тексту");
    const url = validateTestUrl(siteUrl);
    const variants = paragraphs.map((paragraph, index) => {
        const first = mode === "cumulative" ? 1 : index + 1;
        const last = index + 1;
        let text = mode === "cumulative" ? paragraphs.slice(0, last).join("\n\n") : paragraph;
        if (!extractCreativeUrls(text).includes(url)) text += `\n${url}`;
        return { first, last, label: first === last ? `Абзац ${last}` : `Абзаци ${first}–${last}`, text };
    });
    return { mode, sourceText: normalizedText, siteUrl: url, creativeName: String(creativeName).trim().replace(/^Creo_/i, ""), variants };
}

export function validateCreativeTest(test) {
    if (!test || typeof test !== "object") throw invalid("Не передано дані тесту");
    const canonical = buildCreativeTest(test);
    if (!Array.isArray(test.variants) || canonical.variants.length !== test.variants.length
        || canonical.variants.some((item, index) => ["first", "last", "label", "text"].some(key => item[key] !== test.variants[index]?.[key]))) {
        throw invalid("Варіанти тесту не відповідають вихідному тексту та режиму. Підготуйте тест повторно");
    }
    return canonical;
}

export async function prepareCreativeTest(input, prepareCreative) {
    const manual = String(input.manualCreativeText ?? "").trim();
    if (input.sourceMode === "manual" && !manual) throw invalid("Введіть власний текст креативу");
    let text;
    let url = input.siteUrl;
    if (manual) {
        const urls = extractCreativeUrls(manual);
        if (!urls.length) throw invalid("У власному тексті не знайдено HTTP/HTTPS-посилання");
        if (urls.length > 1 && !url) return { urls, selectionRequired: true };
        url = url || urls[0];
        if (!urls.includes(url)) throw invalid("Виберіть основне посилання з власного тексту");
        text = manual;
    } else {
        const prepared = await prepareCreative({ geo: input.language || input.geo, creativeName: input.creativeName, siteUrl: validateTestUrl(url) });
        text = prepared.creative;
    }
    if (input.useCreativeFont) text = applyCreativeFont(text, input.creativeFont || "blurry");
    return { creativeTest: buildCreativeTest({ sourceText: text, siteUrl: url, mode: input.mode, creativeName: input.creativeName }) };
}

export function creativeTestName(test) {
    return `Тест креативу | ${test.creativeName ? `Creo_${test.creativeName}` : "Власний текст"} | ${test.mode === "cumulative" ? "Наростаючий" : "Кожен окремо"} | ${test.variants.length} абзаців`;
}

export function normalizeCreativeTestOptions(options) {
    if (!options.creativeTest) return options;
    const creativeTest = validateCreativeTest(options.creativeTest);
    if (options.posts !== undefined) throw invalid("Тест креативу не підтримує рекламу наявних постів");
    if (!String(options.imagePath ?? "").trim()) throw invalid("Виберіть спільне зображення для тесту");
    const requestedName = String(options.campaignName ?? "").trim();
    const prefix = creativeTestName(creativeTest);
    return {
        ...options, creativeTest, creativeMode: "image", adSetCount: 1, budgetMode: "adset",
        siteUrl: creativeTest.siteUrl, callToActionType: "NO_BUTTON",
        campaignName: !requestedName || requestedName === prefix ? prefix : requestedName.startsWith(`${prefix} | `) ? requestedName : `${prefix} | ${requestedName}`,
        template: options.template ? {
            ...options.template, placements: { facebook: ["feed"], instagram: [] },
            advantageAudience: false, disableCreativeEnhancements: true,
            disableMultiAdvertiserAds: true, allowLimitedPlacementSpend: false, shareAdSetBudget: false,
        } : options.template,
    };
}
