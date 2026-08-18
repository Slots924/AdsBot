import "dotenv/config";

import CreativeManager
    from "../services/creatives/CreativeManager.js";


// Введіть дволітерний код країни, наприклад US, UA, CA або CZ.
const geo = "HU";

// Введіть назву креативу без розширення, наприклад 138 або new_offer.
const creativeName = "138";


async function testCreativeManager() {
    const creativeManager = new CreativeManager();
    const creative = await creativeManager.getCreative(
        geo,
        creativeName
    );

    console.log("\n########################################");
    console.log("# Результат CreativeManager");
    console.log("########################################\n");
    console.table([{
        geo: geo.trim().toUpperCase(),
        creativeName,
        comments: creative.comments.length,
    }]);

    console.log("\n=== КРЕАТИВ ===\n");
    console.log(creative.creative || "Креатив порожній");

    console.log("\n=== КОМЕНТАРІ ===\n");

    if (creative.comments.length === 0) {
        console.log("Коментарів немає");
    } else {
        console.table(creative.comments.map((comment) => ({
            id: comment.id,
            parentId: comment.parent_id ?? "—",
            text: comment.text,
            gender: comment.gender ?? "—",
            profileKey: comment.profile_key ?? "—",
            isAuthor: comment.is_author,
            shouldWrite: comment.should_write,
        })));
    }

    console.log("\n=== ПОВНИЙ JSON ===\n");
    console.log(JSON.stringify(creative, null, 2));
}


testCreativeManager().catch((error) => {
    console.error("\n=== ПОМИЛКА CREATIVE MANAGER ===\n");
    console.table([{
        message: error.message,
        code: error.code ?? "—",
        geo: error.geo ?? geo,
    }]);
    process.exitCode = 1;
});
