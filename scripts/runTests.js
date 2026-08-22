import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";


const backendSuites = {
    campaign: [
        "test/testFacebookCampaignCreationMock.js",
        "test/testCampaignCreationJournal.js",
        "test/testBackgroundTaskManager.js",
        "test/testGuiIpcMock.js",
        "test/testCampaignTemplateManager.js",
    ],
    all: [
        "test/testAdAccountPreferencesStore.js",
        "test/testAdsBotGuiServiceMock.js",
        "test/testAdsPowerBrowserOptionsMock.js",
        "test/testAppLogger.js",
        "test/testBackgroundTaskManager.js",
        "test/testCampaignCreationJournal.js",
        "test/testCampaignTemplateManager.js",
        "test/testChangeFacebookName.js",
        "test/testChangeFacebookProfilePicture.js",
        "test/testCreativeManagerMock.js",
        "test/testFacebookAccountManager.js",
        "test/testFacebookBackendServiceMock.js",
        "test/testFacebookCampaignCreationMock.js",
        "test/testFacebookCampaignsMock.js",
        "test/testFacebookBrowserPrimitives.js",
        "test/testFacebookSelectors.js",
        "test/testOpenFacebookUserProfile.js",
        "test/testFacebookPagePostsMock.js",
        "test/testFacebookPagePublishingMock.js",
        "test/testFacebookPageRebuildGraphMock.js",
        "test/testPageRebuildPlanning.js",
        "test/testPageRebuildWorkflowMock.js",
        "test/testFacebookPixelsMock.js",
        "test/testGrokClientMock.js",
        "test/testGuiIpcMock.js",
        "test/testPagePreferencesStore.js",
        "test/testRemoteDataCacheStore.js",
        "test/testRunCommentingScenarioMock.js",
        "test/testRunParallelCommentingScenarioMock.js",
        "test/testTaskReportManager.js",
    ],
};
const frontendSuites = {
    campaign: ["src/test/campaign.test.jsx"],
    all: [
        "src/test/campaign.test.jsx",
        "src/test/gui.test.jsx",
        "src/test/typography.test.js",
        "src/test/workspace-design.test.jsx",
    ],
};


function run(command, args, label) {
    const started = performance.now();
    console.log(`\n▶ ${label}`);
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
        shell: false,
    });
    const duration = Math.round(performance.now() - started);

    if (result.error) {
        console.error(`✗ ${label}: ${result.error.message} (${duration} мс)`);
        return false;
    }
    if (result.status !== 0) {
        console.error(`✗ ${label}: код ${result.status} (${duration} мс)`);
        return false;
    }

    console.log(`✓ ${label}: ${duration} мс`);
    return true;
}


const suiteName = process.argv[2] ?? "campaign";
const backendTests = backendSuites[suiteName];
if (!backendTests) {
    console.error(`Невідомий набір тестів: ${suiteName}`);
    process.exit(2);
}

const totalStarted = performance.now();
for (const testFile of backendTests) {
    if (!run(process.execPath, [testFile], testFile)) process.exit(1);
}

const npmCli = process.env.npm_execpath;
const frontendCommand = npmCli ? process.execPath : "npm";
for (const testFile of frontendSuites[suiteName]) {
    const frontendArgs = [
        "--prefix",
        "frontend",
        "run",
        "test",
        "--",
        testFile,
    ];
    const frontendCommandArgs = npmCli
        ? [npmCli, ...frontendArgs]
        : frontendArgs;
    if (!run(
        frontendCommand,
        frontendCommandArgs,
        `frontend/${testFile}`
    )) process.exit(1);
}

const totalDuration = Math.round(performance.now() - totalStarted);
console.log(`\nУсі тести набору "${suiteName}" пройдено за ${totalDuration} мс`);
