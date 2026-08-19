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
    appState: path.join(projectRoot, "data/app-state.json"),
    adAccountPreferences: path.join(
        projectRoot,
        "data/ad-account-preferences.json"
    ),
    reports: path.join(projectRoot, "data/reports"),
    renderer: path.join(frontendRoot, "dist/index.html"),
    preload: path.join(electronDirectory, "preload.cjs"),
};
