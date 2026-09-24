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
import searchCollege
    from "../../facebook/api-actions/education/searchCollege.js";
import createEducation
    from "../../facebook/api-actions/education/createEducation.js";
import deleteEducation
    from "../../facebook/api-actions/education/deleteEducation.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const educationSection = "directory_education";
const targetSchoolName = "Oxford Brookes University";


// Друкує короткі логи для підготовчих кроків тесту.
function log(message, details = null) {
    console.log(`[EDUCATION-TEST] ${message}`);
    if (details) console.dir(details, { depth: null, colors: true });
}


// Друкує окремий помітний блок для дій, що змінюють освіту профілю.
function logEducationStep(message, details = null) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(`[EDUCATION] ${message}`);
    if (details) console.dir(details, { depth: null, colors: true });
}


// Друкує повний текст GraphQL-помилок без виведення сесійних токенів.
function logGraphqlErrors(actionName, result) {
    console.error(`\n[EDUCATION] GraphQL-помилки ${actionName}:`);
    console.dir(result.data?.errors ?? result.data ?? null, {
        depth: null,
        colors: true,
    });
}


// Вибирає school_id і school_name для створення запису з результату typeahead.
function resolveSchool(searchResult) {
    const firstOption = searchResult.data?.[0] ?? null;

    if (firstOption && firstOption.fbid !== "-1") {
        return {
            source: "TYPEAHEAD",
            schoolId: firstOption.fbid,
            schoolName: firstOption.value ?? firstOption.title,
        };
    }

    // fbid = -1 означає Add "..."; для custom College Facebook очікує UUID.
    return {
        source: "CUSTOM",
        schoolId: randomUUID(),
        schoolName: targetSchoolName,
    };
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("РУЧНИЙ ТЕСТ FACEBOOK EDUCATION API ACTIONS");
    console.log("=".repeat(72));

    try {
        log(`Отримуємо AdsPower-профіль ${profileNo}`);
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);

        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        log("Відкриваємо профіль і підключаємо Puppeteer");
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();

        log("Отримуємо commonPayload");
        const payloadResult = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });
        if (!payloadResult.success) {
            throw new Error(
                `captureGraphqlPayload: ${payloadResult.status} — `
                + `${payloadResult.error ?? "невідома помилка"}`
            );
        }
        const commonPayload = payloadResult.data;
        log("commonPayload отримано", {
            fieldsCount: Object.keys(commonPayload).length,
        });

        log("Отримуємо collectionToken і sectionToken для Education");
        const tokensResult = await getAboutSectionTokens({
            page,
            commonPayload,
            sections: [educationSection],
            timeout: actionTimeout,
        });
        if (!tokensResult.success) {
            throw new Error(
                `getAboutSectionTokens: ${tokensResult.status} — `
                + `${tokensResult.error ?? "токени не знайдено"}`
            );
        }
        const educationTokens = tokensResult.data[educationSection];
        if (!educationTokens?.collectionToken || !educationTokens?.sectionToken) {
            throw new Error("Не отримано collectionToken або sectionToken для Education");
        }
        log("Токени Education отримано");

        logEducationStep("Читаємо поточні College профілю");
        const currentEducation = await getEducationExperiences({
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            rawSectionToken: educationTokens.rawSectionToken,
            timeout: actionTimeout,
        });
        if (!currentEducation.success) {
            if (currentEducation.status === "GRAPHQL_ERROR") {
                logGraphqlErrors("getEducationExperiences", currentEducation);
            }
            throw new Error(
                `getEducationExperiences: ${currentEducation.status} — `
                + `${currentEducation.error ?? "невідома помилка"}`
            );
        }
        console.dir(currentEducation.data, { depth: null, colors: true });

        for (const education of currentEducation.data) {
            logEducationStep("Видаляємо College", education);
            const deleteResult = await deleteEducation({
                page,
                commonPayload,
                collectionToken: educationTokens.collectionToken,
                sectionToken: educationTokens.sectionToken,
                educationExperienceID: education.education_experience_id,
                timeout: actionTimeout,
            });
            logEducationStep("Результат deleteEducation", {
                success: deleteResult.success,
                status: deleteResult.status,
                httpStatus: deleteResult.httpStatus,
                error: deleteResult.error,
            });

            if (!deleteResult.success) {
                if (deleteResult.status === "GRAPHQL_ERROR") {
                    logGraphqlErrors("deleteEducation", deleteResult);
                }
                throw new Error(
                    `Не вдалося видалити ${education.school_name}: ${deleteResult.status}`
                );
            }
        }

        logEducationStep("Перевіряємо, що всі College видалено");
        const educationAfterDelete = await getEducationExperiences({
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            rawSectionToken: educationTokens.rawSectionToken,
            timeout: actionTimeout,
        });
        if (!educationAfterDelete.success) {
            throw new Error(
                `Перевірка після delete: ${educationAfterDelete.status}`
            );
        }
        console.dir(educationAfterDelete.data, { depth: null, colors: true });
        if (educationAfterDelete.data.length > 0) {
            throw new Error("Не всі College були видалені; створення Oxford скасовано");
        }

        logEducationStep(`Шукаємо "${targetSchoolName}" через typeahead`);
        const searchResult = await searchCollege({
            page,
            commonPayload,
            query: targetSchoolName,
            timeout: actionTimeout,
        });
        if (!searchResult.success) {
            if (searchResult.status === "GRAPHQL_ERROR") {
                logGraphqlErrors("searchCollege", searchResult);
            }
            throw new Error(
                `searchCollege: ${searchResult.status} — `
                + `${searchResult.error ?? "невідома помилка"}`
            );
        }
        console.dir(searchResult.data, { depth: null, colors: true });

        const school = resolveSchool(searchResult);
        logEducationStep("Створюємо новий College", {
            schoolName: school.schoolName,
            source: school.source,
            schoolIdReceived: Boolean(school.schoolId),
        });
        const createResult = await createEducation({
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            schoolId: school.schoolId,
            schoolName: school.schoolName,
            timeout: actionTimeout,
        });
        logEducationStep("Результат createEducation", {
            success: createResult.success,
            status: createResult.status,
            httpStatus: createResult.httpStatus,
            error: createResult.error,
        });
        if (!createResult.success) {
            if (createResult.status === "GRAPHQL_ERROR") {
                logGraphqlErrors("createEducation", createResult);
            }
            throw new Error(`Не вдалося створити College: ${createResult.status}`);
        }

        logEducationStep("Фінальна перевірка College");
        const finalEducation = await getEducationExperiences({
            page,
            commonPayload,
            collectionToken: educationTokens.collectionToken,
            sectionToken: educationTokens.sectionToken,
            rawSectionToken: educationTokens.rawSectionToken,
            timeout: actionTimeout,
        });
        if (!finalEducation.success) {
            throw new Error(`Фінальна перевірка: ${finalEducation.status}`);
        }
        console.dir(finalEducation.data, { depth: null, colors: true });
    } catch (error) {
        console.error("\n[EDUCATION-TEST] ПОМИЛКА:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) {
            log("Відключаємо Puppeteer; браузер лишається відкритим");
            browser.disconnect();
        }
        if (profileOpened) {
            log(`AdsPower-профіль ${profileNo} залишено відкритим для перевірки`);
        }
    }
}


main();
