import "dotenv/config";

import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getAboutSectionTokens
    from "../../facebook/api-actions/getAboutSectionTokens.js";
import getEducationExperiences
    from "../../facebook/api-actions/education/getEducationExperiences.js";
import deleteEducation
    from "../../facebook/api-actions/education/deleteEducation.js";
import searchCollege
    from "../../facebook/api-actions/education/searchCollege.js";
import createEducation
    from "../../facebook/api-actions/education/createEducation.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const educationSection = "directory_education";
const targetSchoolName = "Northbridge Institute of Applied Cartography";


// Виводить короткий заголовок етапу та, за потреби, його дані.
function logStep(message, details = null) {
    console.log(`\n[EDUCATION-TEST] ${message}`);
    if (details) console.dir(details, { depth: null, colors: true });
}


// Виводить повну відповідь або помилку Education action.
function logActionResult(actionName, result) {
    console.log(`[EDUCATION-TEST] Результат ${actionName}:`);
    console.dir(result, { depth: null, colors: true });

    if (!result?.success) {
        console.error(`[EDUCATION-TEST] Помилка ${actionName}:`);
        console.dir(result?.data?.errors ?? result, {
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
    console.log("ТЕСТ СТВОРЕННЯ FACEBOOK EDUCATION");
    console.log("=".repeat(72));

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) {
            throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        }
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
        logStep("Підготовка браузерної сесії", {
            success: payloadResult.success,
            status: payloadResult.status,
            profileUrl: payloadResult.profileUrl,
        });
        if (!payloadResult.success) {
            throw new Error(
                `captureGraphqlPayload: ${payloadResult.status} — `
                + `${payloadResult.error ?? "невідома помилка"}`
            );
        }

        const commonPayload = payloadResult.data ?? {};
        const tokensResult = await getAboutSectionTokens({
            page,
            commonPayload,
            sections: [educationSection],
            timeout: actionTimeout,
        });
        logStep("Отримання токенів Education", {
            success: tokensResult.success,
            status: tokensResult.status,
            missingSections: tokensResult.missingSections,
            error: tokensResult.error,
        });
        if (!tokensResult.success) {
            throw new Error(
                `getAboutSectionTokens: ${tokensResult.status} — `
                + `${tokensResult.error ?? "не вдалося отримати токени"}`
            );
        }

        const educationTokens = tokensResult.data?.[educationSection];
        if (!educationTokens?.collectionToken || !educationTokens?.sectionToken
            || !educationTokens?.rawSectionToken) {
            throw new Error("Не отримано повний набір токенів для Education");
        }

        const educationParams = {
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            rawSectionToken: educationTokens.rawSectionToken,
            timeout: actionTimeout,
        };

        logStep("Читаємо наявні навчальні заклади");
        const initialEducation = await getEducationExperiences(educationParams);
        logActionResult("початкового читання Education", initialEducation);
        if (!initialEducation.success) {
            throw new Error(`getEducationExperiences: ${initialEducation.status}`);
        }

        for (const education of initialEducation.data) {
            logStep("Видаляємо наявний навчальний заклад", {
                name: education.school_name,
                educationExperienceID: education.education_experience_id,
            });
            const deleteResult = await deleteEducation({
                page,
                commonPayload,
                collectionToken: educationTokens.collectionToken,
                sectionToken: educationTokens.sectionToken,
                educationExperienceID: education.education_experience_id,
                timeout: actionTimeout,
            });
            logActionResult("deleteEducation", deleteResult);
            if (!deleteResult.success) {
                throw new Error(`deleteEducation: ${deleteResult.status}`);
            }
        }

        const afterDelete = await getEducationExperiences(educationParams);
        logActionResult("перевірки після видалення", afterDelete);
        if (!afterDelete.success) {
            throw new Error(
                `Перевірка після видалення: ${afterDelete.status}`
            );
        }
        if (afterDelete.data.length > 0) {
            throw new Error("Не всі наявні навчальні заклади вдалося видалити");
        }
        logStep("Профіль очищено від наявних навчальних закладів");

        logStep("Шукаємо вигадану назву перед створенням", {
            schoolName: targetSchoolName,
        });
        const searchResult = await searchCollege({
            page,
            commonPayload,
            query: targetSchoolName,
            timeout: actionTimeout,
        });
        logActionResult("searchCollege", searchResult);
        if (!searchResult.success) {
            throw new Error(`searchCollege: ${searchResult.status}`);
        }

        const school = {
            id: randomUUID(),
            name: targetSchoolName,
        };
        logStep("Надсилаємо mutation створення custom College", {
            schoolId: school.id,
            schoolName: school.name,
            searchStatus: searchResult.status,
            searchOptions: searchResult.data,
        });
        const createResult = await createEducation({
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            schoolId: school.id,
            schoolName: school.name,
            timeout: actionTimeout,
        });
        logActionResult("createEducation", createResult);

        logStep("Фінально читаємо навчальні заклади профілю");
        const finalEducation = await getEducationExperiences(educationParams);
        logActionResult("фінальної перевірки Education", finalEducation);
        if (!finalEducation.success) {
            throw new Error(`Фінальна перевірка: ${finalEducation.status}`);
        }

        const targetWasCreated = finalEducation.data.some(
            (item) => item.school_name.trim().toLowerCase()
                === targetSchoolName.toLowerCase()
        );
        logStep("Підсумок тесту", {
            createSuccess: createResult.success,
            targetSchoolName,
            targetWasCreated,
            finalEducationCount: finalEducation.data.length,
            finalEducation: finalEducation.data,
        });
        if (!createResult.success || !targetWasCreated) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[EDUCATION-TEST] Помилка ручного тесту:");
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
