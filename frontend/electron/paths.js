import path from "node:path";
import { fileURLToPath } from "node:url";


const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(electronDirectory, "../..");
export const frontendRoot = path.join(projectRoot, "frontend");

export const appPaths = {
    env: path.join(projectRoot, ".env"),
    accounts: path.join(projectRoot, "data/facebookApi/accounts.json"),
    proxies: path.join(projectRoot, "data/facebookApi/proxies.json"),
    countries: path.join(projectRoot, "data/countries.json"),
    creatives: path.join(projectRoot, "data/creatives"),
    prompt: path.join(
        projectRoot,
        "data/prompts/grok/format-creative-to-json.txt"
    ),
    groups: path.join(projectRoot, "data/adspower-groups.json"),
    templates: path.join(projectRoot, "data/campaign-templates.json"),
    keitaroStreamTemplates: path.join(
        projectRoot,
        "data/keitaro-stream-templates.json"
    ),
    keitaroCampaignSettings: path.join(
        projectRoot,
        "data/keitaro-campaign-settings.json"
    ),
    campaignCreationJobs: path.join(
        projectRoot,
        "data/campaign-creation-jobs.json"
    ),
    backgroundTasks: path.join(projectRoot, "data/background-tasks.json"),
    spendDatabase: path.join(projectRoot, "data/spend/spend.sqlite"),
    appState: path.join(projectRoot, "data/app-state.json"),
    adAccountPreferences: path.join(
        projectRoot,
        "data/ad-account-preferences.json"
    ),
    pagePreferences: path.join(projectRoot, "data/page-preferences.json"),
    remoteDataCache: path.join(projectRoot, "data/gui-remote-cache.json"),
    remoteImages: path.join(projectRoot, "data/gui-cache-images"),
    creativeLaunchJobs: path.join(projectRoot, "data/creative-launch-jobs.json"),
    pageRebuildJobs: path.join(projectRoot, "data/page-rebuild-jobs.json"),
    reports: path.join(projectRoot, "data/reports"),
    taskReports: path.join(projectRoot, "data/reports/tasks"),
    logs: path.join(projectRoot, "data/logs"),
    renderer: path.join(frontendRoot, "dist/index.html"),
    preload: path.join(electronDirectory, "preload.cjs"),
};
