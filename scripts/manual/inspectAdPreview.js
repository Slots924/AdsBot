import "dotenv/config";

import createFacebookApiClients
    from "../../facebook/api/createFacebookApiClients.js";


const [accountKey, creativeId] = process.argv.slice(2);
if (!accountKey || !/^\d+$/.test(String(creativeId ?? ""))) {
    throw new Error(
        "Використання: node scripts/manual/inspectAdPreview.js <accountKey> <creativeId>"
    );
}

const clients = await createFacebookApiClients();
const api = clients.get(accountKey);
if (!api) {
    throw new Error(`Facebook API-клієнт "${accountKey}" не знайдено`);
}

const previews = await api.getAdCreativePreviews({ creativeId });
const body = String(previews[0]?.body ?? "");
const sourceMatch = body.match(/src=["']([^"']+)/i);

console.log(sourceMatch?.[1]?.replaceAll("&amp;", "&") ?? "NO_PREVIEW_URL");
