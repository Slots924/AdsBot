import { createValidationError } from "../api/validation.js";
import {
    buildCampaignFields,
    buildAdSetFields,
    buildAdFields,
    verifyCampaignReadback,
} from "../services/campaigns/CampaignSettings.js";
import { buildCampaignCreativeFields } from "../services/campaigns/CampaignCreative.js";

export default async function createLeadCampaign(options, onProgress = () => {}, operations) {
    const {
        campaignName,
        template,
        adSetCount,
        createPaused = true,
        createAdSetsPaused = true,
        createAdsPaused = true,
        adCreative = null,
    } = options;
    const count = Number(adSetCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw createValidationError(
            "Кількість ad sets має бути від 1 до 100",
            "CAMPAIGN_ADSET_COUNT_INVALID"
        );
    }
    const name = String(campaignName ?? "").trim();
    if (!name) {
        throw createValidationError(
            "Вкажіть назву кампанії",
            "CAMPAIGN_NAME_REQUIRED"
        );
    }
    const objects = {
        campaignId: null,
        creativeId: null,
        adSets: [],
        ads: [],
    };
    const emit = async (stage, detail = {}) => onProgress({
        stage,
        objects: structuredClone(objects),
        ...detail,
    });
    let currentStage = "preflight";
    let currentIndex = null;

    try {
        await emit("preflight", { message: "Перевіряємо доступи та ресурси" });
        const preflight = await operations.preflight(options);
        await emit("preflight-complete", { preflight });

        currentStage = "campaign";
        const campaign = await operations.createCampaign(preflight.adAccountId, buildCampaignFields(name, template));
        objects.campaignId = campaign.id;
        await emit("campaign", { message: "Campaign створено" });

        currentStage = "creative";
        let imageHash;
        if (options.creativeMode === "image") {
            if (!adCreative?.image) {
                throw createValidationError(
                    "Не передано зображення рекламного оголошення",
                    "CAMPAIGN_AD_IMAGE_REQUIRED"
                );
            }
            imageHash = await operations.uploadImage(preflight.adAccountId, adCreative.image);
        }
        const creativeFields = buildCampaignCreativeFields({ options, name, preflight, imageHash });
        await operations.createCreative(
            preflight.adAccountId,
            creativeFields,
            { validateOnly: true }
        );
        const creative = await operations.createCreative(
            preflight.adAccountId,
            creativeFields
        );
        objects.creativeId = creative.id;
        await emit("creative", { message: "Creative створено" });

        for (let index = 0; index < count; index += 1) {
            currentIndex = index;
            const ordinal = String(index + 1).padStart(2, "0");
            currentStage = "adset";
            const adSetFields = buildAdSetFields({ name, ordinal, campaignId: objects.campaignId, template, preflight });
            await operations.createAdSet(
                preflight.adAccountId,
                adSetFields,
                { validateOnly: true }
            );
            const createdAdSet = await operations.createAdSet(
                preflight.adAccountId,
                adSetFields
            );
            const adSet = { index, id: createdAdSet.id, name: adSetFields.name };
            objects.adSets.push(adSet);
            await emit("adset", {
                index,
                message: `Ad set ${index + 1}/${count} створено`,
            });

            currentStage = "ad";
            const adFields = buildAdFields({ name, ordinal, adSetId: adSet.id, creativeId: objects.creativeId });
            await operations.createAd(
                preflight.adAccountId,
                adFields,
                { validateOnly: true }
            );
            const ad = await operations.createAd(
                preflight.adAccountId,
                adFields
            );
            objects.ads.push({ index, id: ad.id, name: adFields.name });
            await emit("ad", {
                index,
                message: `Ad ${index + 1}/${count} створено`,
            });
        }

        if (!createAdsPaused || !createAdSetsPaused || !createPaused) {
            currentStage = "activation";
            if (!createAdsPaused) {
                for (const ad of objects.ads) {
                    await operations.activate(ad.id);
                }
            }
            if (!createAdSetsPaused) {
                for (const adSet of objects.adSets) {
                    await operations.activate(adSet.id);
                }
            }
            if (!createPaused) {
                await operations.activate(objects.campaignId);
            }
            await emit("activation", { message: "Вибрані об’єкти активовано" });
        }

        currentStage = "readback";
        await emit("readback", { message: "Перевіряємо створені об’єкти" });
        const readback = await operations.readback(objects);
        readback.warnings = verifyCampaignReadback({ readback, preflight, template });

        await emit("complete", { message: "Створення завершено" });
        return { objects, preflight, readback, createPaused };
    } catch (error) {
        error.stage = currentStage;
        error.itemIndex = currentIndex;
        error.createdObjects = structuredClone(objects);
        throw error;
    }
}
