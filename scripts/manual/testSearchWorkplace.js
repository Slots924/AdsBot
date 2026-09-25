import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getAboutSectionTokens
    from "../../facebook/api-actions/getAboutSectionTokens.js";
import createCustomWorkExperience
    from "../../facebook/api-actions/workplace/createCustomWorkExperience.js";
import deleteWorkExperience
    from "../../facebook/api-actions/workplace/deleteWorkExperience.js";
import getWorkExperiences
    from "../../facebook/api-actions/workplace/getWorkExperiences.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const workSection = "directory_work";
const customCompanyName = "Alderwick Geospatial Works";
const customJobTitleName = "Regional Cartography Operations Specialist";


// Виводить короткий етап ручного тесту.
function logStep(message, details = null) {
    console.log(`\n[WORKPLACE-TEST] ${message}`);
    if (details) console.dir(details, { depth: null, colors: true });
}


// Виводить повні деталі action лише для створення або у випадку помилки.
function logActionResult(actionName, result, { detailed = false } = {}) {
    console.log(`[WORKPLACE-TEST] ${actionName}: ${result.status}`);

    if (detailed || !result.success) {
        console.dir(result, { depth: null, colors: true });
    }
    if (!result.success) {
        console.error(`[WORKPLACE-TEST] Помилка ${actionName}:`);
        console.dir(result.data?.errors ?? result, {
            depth: null,
            colors: true,
        });
    }
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("ТЕСТ СТВОРЕННЯ CUSTOM FACEBOOK WORK EXPERIENCE");
    console.log("=".repeat(72));

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0] ?? await browser.newPage();
        const payloadResult = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });
        logActionResult("captureGraphqlPayload", payloadResult);
        if (!payloadResult.success) {
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        const commonPayload = payloadResult.data;
        const tokensResult = await getAboutSectionTokens({
            page,
            commonPayload,
            sections: [workSection],
            timeout: actionTimeout,
        });
        logActionResult("getAboutSectionTokens", tokensResult);
        if (!tokensResult.success) {
            throw new Error(`getAboutSectionTokens: ${tokensResult.status}`);
        }

        const workTokens = tokensResult.data?.[workSection];
        if (!workTokens?.collectionToken || !workTokens?.sectionToken
            || !workTokens?.rawSectionToken) {
            throw new Error("Не отримано повний набір токенів для Work");
        }

        const workParams = {
            page,
            commonPayload,
            collectionToken: workTokens.collectionToken,
            sectionToken: workTokens.sectionToken,
            rawSectionToken: workTokens.rawSectionToken,
            timeout: actionTimeout,
        };

        logStep("Читаємо наявні Work Experience");
        const initialWork = await getWorkExperiences(workParams);
        logActionResult("getWorkExperiences", initialWork);
        if (!initialWork.success) {
            throw new Error(`getWorkExperiences: ${initialWork.status}`);
        }

        for (const workExperience of initialWork.data) {
            console.log(
                `[WORKPLACE-TEST] Видаляємо ${workExperience.company_name} `
                + `(${workExperience.work_experience_id})`
            );
            const deleteResult = await deleteWorkExperience({
                page,
                commonPayload,
                collectionToken: workTokens.collectionToken,
                sectionToken: workTokens.sectionToken,
                workExperienceID: workExperience.work_experience_id,
                timeout: actionTimeout,
            });
            logActionResult("deleteWorkExperience", deleteResult);
            if (!deleteResult.success) {
                throw new Error(`deleteWorkExperience: ${deleteResult.status}`);
            }
        }

        const workAfterDelete = await getWorkExperiences(workParams);
        logActionResult("перевірка після видалення", workAfterDelete);
        if (!workAfterDelete.success || workAfterDelete.data.length > 0) {
            throw new Error("Не всі Work Experience вдалося видалити");
        }

        logStep("Створюємо custom компанію і посаду", {
            companyName: customCompanyName,
            jobTitleName: customJobTitleName,
        });
        const createResult = await createCustomWorkExperience({
            page,
            commonPayload,
            collectionToken: workTokens.collectionToken,
            sectionToken: workTokens.sectionToken,
            companyName: customCompanyName,
            jobTitleName: customJobTitleName,
            timeout: actionTimeout,
        });
        logActionResult("createCustomWorkExperience", createResult, {
            detailed: true,
        });
        if (!createResult.success) {
            throw new Error(`createCustomWorkExperience: ${createResult.status}`);
        }

        const finalWork = await getWorkExperiences(workParams);
        logActionResult("фінальна перевірка Work Experience", finalWork);
        if (!finalWork.success) {
            throw new Error(`Фінальна перевірка: ${finalWork.status}`);
        }

        const customWorkWasCreated = finalWork.data.some(
            (workExperience) => (
                workExperience.company_name.trim().toLowerCase()
                    === customCompanyName.toLowerCase()
                && workExperience.position_name?.trim().toLowerCase()
                    === customJobTitleName.toLowerCase()
            )
        );
        logStep("Підсумок тесту", {
            createSuccess: createResult.success,
            customWorkWasCreated,
            finalWorkExperiences: finalWork.data,
        });
        if (!customWorkWasCreated) process.exitCode = 1;
    } catch (error) {
        console.error("\n[WORKPLACE-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            logStep(`AdsPower-профіль ${profileNo} залишено відкритим для перевірки`);
        }
        console.log("\nТест завершено");
        console.log("=".repeat(72));
    }
}


main();
