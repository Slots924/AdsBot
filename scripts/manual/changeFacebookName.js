import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import changeFacebookName, {
    facebookNameChangeStatuses,
} from "../../facebook/actions/changeFacebookName.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const targetName = {
    firstName: "Vojtěch",
    lastName: "Sedláček",
};
const successfulAdsPowerName =
    "m_Vojtěch Sedláček only changed name";
const browserMode = process.argv.includes("--headless")
    ? "headless"
    : "visible";
const configuredTestCases = [
    {
        profileNo: 1882,
        expectedStatus: facebookNameChangeStatuses.RECENTLY_CHANGED,
    },
    {
        profileNo: 1385,
        expectedStatus: facebookNameChangeStatuses.UNUSUAL_DEVICE,
    },
    {
        profileNo: 1365,
        expectedStatus: facebookNameChangeStatuses.WHATSAPP_REQUIRED,
    },
    {
        profileNo: 1880,
        expectedStatus: facebookNameChangeStatuses.CHANGED,
        renameAdsPowerProfile: true,
    },
];
const profilesArgument = process.argv.find((argument) =>
    argument.startsWith("--profiles=")
);
const selectedProfileNumbers = profilesArgument
    ? new Set(
        profilesArgument
            .slice("--profiles=".length)
            .split(",")
            .map((value) => Number(value.trim()))
            .filter(Number.isFinite)
    )
    : null;
const testCases = selectedProfileNumbers
    ? configuredTestCases.filter((testCase) =>
        selectedProfileNumbers.has(testCase.profileNo)
    )
    : configuredTestCases;


function createTimestamp(value) {
    return new Date(value).toISOString()
        .replace(/[:.]/g, "-");
}


async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    const filePath = path.join(
        directory,
        `facebook-name-change-report_${createTimestamp(report.finishedAt)}.json`
    );

    await mkdir(directory, { recursive: true });
    await writeFile(
        filePath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
    );

    return filePath;
}


async function runProfileTest(adsPower, testCase) {
    const { profileNo, expectedStatus } = testCase;
    const startedAt = new Date().toISOString();
    const result = {
        profileNo,
        expectedStatus,
        actualStatus: null,
        expectedStatusMatched: false,
        stage: "GET_PROFILE",
        actionStage: null,
        failedStage: null,
        failedSelector: null,
        startedAt,
        finishedAt: null,
        action: null,
        adsPowerRename: null,
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;

    console.log("\n============================================================");
    console.log(`Профіль ${profileNo}: очікуємо ${expectedStatus}`);
    console.log("============================================================");

    try {
        console.log(`[${profileNo}] Отримуємо AdsPower-профіль`);
        const profile = await adsPower.getProfileByNo(profileNo);

        result.stage = "ADSPOWER_READY";
        console.log(`[${profileNo}] Перевіряємо готовність AdsPower-профілю`);
        const adsPowerReady = await ensureAdsPowerProfileReady(
            adsPower,
            profile
        );

        if (!adsPowerReady) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        result.stage = "OPEN_PROFILE";
        console.log(
            `[${profileNo}] Відкриваємо профіль у режимі ${browserMode}`
        );
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode,
        });
        profileOpened = true;

        result.stage = "CONNECT_BROWSER";
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();

        if (browserMode === "headless") {
            await page.setViewport({
                width: 1280,
                height: 900,
                deviceScaleFactor: 1,
            });
            console.log(
                `[${profileNo}] Встановлено headless viewport 1280×900`
            );
        }

        page.setDefaultTimeout(45000);
        page.setDefaultNavigationTimeout(60000);

        result.stage = "OPEN_FACEBOOK";
        console.log(`[${profileNo}] Відкриваємо Facebook`);
        await openPageWithoutPopups(
            page,
            "https://www.facebook.com/"
        );
        const viewport = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
        }));
        console.log(
            `[${profileNo}] Фактичний viewport: ${viewport.width}×${viewport.height}`
        );
        console.log(`[${profileNo}] Поточний URL: ${page.url()}`);

        result.stage = "FACEBOOK_LOGIN";
        const loggedIn = await ensureFacebookAccountLoggedIn(
            adsPower,
            profile,
            page
        );

        if (!loggedIn) {
            throw new Error(
                "Не вдалося підтвердити вхід у Facebook"
            );
        }

        result.stage = "FACEBOOK_ACTIVE";
        const active = await ensureFacebookAccountActive(
            adsPower,
            profile,
            page
        );

        if (!active) {
            throw new Error("Facebook-акаунт неактивний");
        }

        result.stage = "CHANGE_FACEBOOK_NAME";
        result.action = await changeFacebookName(page, targetName);
        result.actualStatus = result.action.status;
        result.actionStage = result.action.stage;
        result.failedStage = result.action.success
            ? null
            : result.action.stage;
        result.failedSelector = result.action.failedSelector;
        result.expectedStatusMatched =
            result.actualStatus === expectedStatus;

        console.log(
            `[${profileNo}] changeFacebookName: ${result.actualStatus}`
        );
        console.log(
            `[${profileNo}] Очікування збігається: ${result.expectedStatusMatched}`
        );

        if (
            result.action.success
            && testCase.renameAdsPowerProfile
        ) {
            result.stage = "RENAME_ADSPOWER_PROFILE";
            console.log(
                `[${profileNo}] Оновлюємо назву AdsPower-профілю`
            );
            await adsPower.updateProfileName(
                profile.profile_id,
                successfulAdsPowerName
            );

            const updatedProfile = await adsPower.getProfileByNo(
                profileNo
            );
            const verified = updatedProfile.name
                === successfulAdsPowerName;

            result.adsPowerRename = {
                attempted: true,
                expectedName: successfulAdsPowerName,
                actualName: updatedProfile.name,
                verified,
            };

            if (!verified) {
                throw new Error(
                    "AdsPower повернув неочікувану назву профілю після оновлення"
                );
            }
        }
    } catch (error) {
        result.error = {
            code: error.code ?? "FACEBOOK_NAME_TEST_FAILED",
            message: error.message,
            stage: error.stage ?? result.stage,
            selector: error.selector ?? null,
            timeoutMs: error.timeoutMs ?? null,
            url: error.url ?? null,
            name: error.name,
            stack: error.stack ?? null,
        };
        result.failedStage = result.error.stage;
        result.failedSelector = result.error.selector;
        console.error(
            `[${profileNo}] Помилка на етапі ${result.stage}: ${error.message}`
        );
    } finally {
        if (browser) {
            try {
                browser.disconnect();
                console.log(`[${profileNo}] Puppeteer від’єднано`);
            } catch (error) {
                result.cleanupErrors.push(
                    `Puppeteer disconnect: ${error.message}`
                );
            }
        }

        if (profileOpened) {
            try {
                await adsPower.closeProfile(profileNo);
                console.log(`[${profileNo}] AdsPower-профіль закрито`);
            } catch (error) {
                result.cleanupErrors.push(
                    `AdsPower closeProfile: ${error.message}`
                );
            }
        }

        result.finishedAt = new Date().toISOString();
        result.durationMs =
            new Date(result.finishedAt) - new Date(startedAt);
    }

    return result;
}


async function runTests() {
    if (testCases.length === 0) {
        throw new Error(
            "Аргумент --profiles не містить профілів із тестового набору"
        );
    }

    const adsPower = new AdsPower();
    const startedAt = new Date().toISOString();
    const report = {
        version: 1,
        title: "Тест зміни імені Facebook",
        startedAt,
        finishedAt: null,
        browserMode,
        targetName,
        successfulAdsPowerName,
        profiles: [],
        summary: null,
    };

    console.log("=== Початок ручного тесту changeFacebookName ===");
    console.log(
        `Цільове ім’я: ${targetName.firstName} ${targetName.lastName}`
    );
    console.log(`Режим браузера: ${browserMode}`);

    for (const testCase of testCases) {
        report.profiles.push(
            await runProfileTest(adsPower, testCase)
        );
    }

    report.finishedAt = new Date().toISOString();
    report.summary = {
        total: report.profiles.length,
        matched: report.profiles.filter(
            (item) => item.expectedStatusMatched
        ).length,
        mismatched: report.profiles.filter(
            (item) => !item.expectedStatusMatched
        ).length,
        errors: report.profiles.filter(
            (item) => item.error
        ).length,
        actionFailures: report.profiles.filter(
            (item) => item.action?.error
        ).length,
        cleanupErrors: report.profiles.reduce(
            (sum, item) => sum + item.cleanupErrors.length,
            0
        ),
    };

    const reportPath = await saveReport(report);

    console.log("\n=== Підсумок ручного тесту changeFacebookName ===");
    console.table(report.profiles.map((item) => ({
        profile: item.profileNo,
        expected: item.expectedStatus,
        actual: item.actualStatus ?? "НЕ ЗАПУЩЕНО",
        matched: item.expectedStatusMatched,
        stage: item.actionStage ?? item.stage,
        selector: item.failedSelector ?? "",
        error: item.error?.message
            ?? item.action?.error?.message
            ?? "",
    })));
    console.log(`Детальний JSON-звіт: ${reportPath}`);

    if (
        report.summary.mismatched > 0
        || report.summary.errors > 0
        || report.summary.cleanupErrors > 0
    ) {
        process.exitCode = 1;
    }
}


runTests().catch((error) => {
    console.error("Критична помилка тесту:", error.stack ?? error.message);
    process.exitCode = 1;
});
