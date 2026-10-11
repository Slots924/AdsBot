import { createValidationError, requireCreatedObjectId } from "../api/validation.js";
import { getLogger } from "../../services/logging/runtimeLogger.js";
import { summarizeGraphResponse } from "../api/graphDiagnostics.js";
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
        creatives: [],
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
    const metaWarnings = [];
    const collectWarnings = (response) => {
        for (const warning of summarizeGraphResponse({ data: response }).warnings) {
            metaWarnings.push(`Meta: ${typeof warning === "string" ? warning : warning?.message || warning?.error_user_msg || `попередження ${warning?.code ?? "без коду"}`}`);
        }
        return response;
    };

    try {
        await emit("preflight", { message: "Перевіряємо доступи та ресурси" });
        const preflight = await operations.preflight(options);
        await emit("preflight-complete", { preflight });

        currentStage = "campaign";
        const campaign = await operations.createCampaign(preflight.adAccountId, buildCampaignFields(name, template, preflight));
        collectWarnings(campaign);
        objects.campaignId = requireCreatedObjectId(campaign);
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
        const postPreflights = preflight.posts ?? [preflight];
        for (const [creativeIndex, postPreflight] of postPreflights.entries()) {
            const creativeFields = buildCampaignCreativeFields({
                options,
                name: postPreflights.length > 1 ? `${name} | ${postPreflight.postId}` : name,
                preflight: postPreflight,
                imageHash,
            });
            collectWarnings(await operations.createCreative(preflight.adAccountId, creativeFields, { validateOnly: true }));
            const creative = await operations.createCreative(preflight.adAccountId, creativeFields);
            collectWarnings(creative);
            const creativeId = requireCreatedObjectId(creative);
            objects.creativeId ??= creativeId;
            objects.creatives.push({
                id: creativeId,
                pageId: postPreflight.pageId,
                postId: postPreflight.postId,
                creativeName: options.posts?.[creativeIndex]?.creativeName,
            });
            await emit("creative", { message: `Креатив ${objects.creatives.length}/${postPreflights.length} створено` });
        }

        for (let index = 0; index < count; index += 1) {
            currentIndex = index;
            const ordinal = String(index + 1).padStart(2, "0");
            currentStage = "adset";
            const adSetFields = buildAdSetFields({ name, ordinal, campaignId: objects.campaignId, template, preflight });
            collectWarnings(await operations.createAdSet(
                preflight.adAccountId,
                adSetFields,
                { validateOnly: true }
            ));
            const createdAdSet = await operations.createAdSet(
                preflight.adAccountId,
                adSetFields
            );
            collectWarnings(createdAdSet);
            const adSet = { index, id: requireCreatedObjectId(createdAdSet), name: adSetFields.name };
            objects.adSets.push(adSet);
            await emit("adset", {
                index,
                message: `Ad set ${index + 1}/${count} створено`,
            });

            currentStage = "ad";
            for (const [creativeIndex, creative] of objects.creatives.entries()) {
                const adFields = buildAdFields({
                    name,
                    ordinal: objects.creatives.length > 1 ? `${ordinal} | ${creative.postId}` : ordinal,
                    adSetId: adSet.id,
                    creativeId: creative.id,
                    creativeName: creative.creativeName,
                });
                collectWarnings(await operations.createAd(preflight.adAccountId, adFields, { validateOnly: true }));
                const ad = await operations.createAd(preflight.adAccountId, adFields);
                collectWarnings(ad);
                objects.ads.push({ index, creativeIndex, id: requireCreatedObjectId(ad), name: adFields.name });
                await emit("ad", {
                    index,
                    creativeIndex,
                    message: `Оголошення ${objects.ads.length}/${count * objects.creatives.length} створено`,
                });
            }
        }

        if (!createAdsPaused || !createAdSetsPaused || !createPaused) {
            currentStage = "activation";
            if (!createAdsPaused) {
                for (const ad of objects.ads) {
                    currentIndex = ad.index;
                    collectWarnings(await operations.activate(ad.id));
                }
            }
            if (!createAdSetsPaused) {
                for (const adSet of objects.adSets) {
                    currentIndex = adSet.index;
                    collectWarnings(await operations.activate(adSet.id));
                }
            }
            if (!createPaused) {
                currentIndex = null;
                collectWarnings(await operations.activate(objects.campaignId));
            }
            await emit("activation", { message: "Вибрані об’єкти активовано" });
        }

        currentStage = "readback";
        currentIndex = null;
        await emit("readback", { message: "Перевіряємо створені об’єкти" });
        const readback = await operations.readback(objects);
        readback.warnings = [...new Set([...metaWarnings, ...(readback.creatives ?? [readback.creative]).flatMap((creative) => verifyCampaignReadback({ readback: { ...readback, creative }, preflight, template }))])];
        readback.dsaChecks = preflight.dsa ? readback.adSets.map((adSet) => ({
            adSetId: adSet.id,
            expectedBeneficiary: preflight.dsa.beneficiary,
            expectedPayor: preflight.dsa.payor,
            actualBeneficiary: adSet.dsa_beneficiary ?? null,
            actualPayor: adSet.dsa_payor ?? null,
            matches: adSet.dsa_beneficiary === preflight.dsa.beneficiary
                && adSet.dsa_payor === preflight.dsa.payor,
        })) : [];
        if (readback.warnings.length) {
            getLogger("facebook.campaign").warn("campaign.readback.warnings", "Контрольна перевірка кампанії має попередження", {
                campaignId: objects.campaignId,
                warnings: readback.warnings,
                dsaChecks: readback.dsaChecks,
            });
        }

        await emit("complete", { message: "Створення завершено" });
        return { objects, preflight, readback, createPaused };
    } catch (error) {
        error.stage = currentStage;
        error.itemIndex = currentIndex;
        error.createdObjects = structuredClone(objects);
        throw error;
    }
}
