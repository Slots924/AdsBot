import "dotenv/config";

import FacebookBackendService
    from "../../facebook/services/FacebookBackendService.js";


const [accountKey, pageId, imagesDirectory, pageCreatedAt] = process.argv.slice(2);
if (!accountKey || !pageId || !imagesDirectory) {
    throw new Error(
        "Використання: node scripts/manual/rebuildPageFromFolder.js <accountKey> <pageId> <imagesDirectory> [pageCreatedAt]"
    );
}

console.warn(
    `Усі старі пости й фото фанпейджа ${pageId} буде видалено без відновлення.`
);
const backend = await FacebookBackendService.create();
const result = await backend.rebuildPageFromFolder({
    accountKey,
    pageId,
    imagesDirectory,
    ...(pageCreatedAt ? { pageCreatedAt } : {}),
}, (progress) => {
    console.log(`[${progress.stage}] ${progress.message}`);
});

console.log(JSON.stringify(result, null, 2));
