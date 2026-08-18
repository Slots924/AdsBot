import "dotenv/config";

import createFacebookApiClients from "../facebook/api/createFacebookApiClients.js";


// Ключ акаунта FP Hub для ручної перевірки
const accountKey = "fp_hub";


function printSection(title) {
    console.log(`\n=== ${title} ===`);
}


function printPermissionGroup(label, permissions) {
    const value = permissions.length > 0
        ? permissions.join(", ")
        : "—";

    console.log(`${label} (${permissions.length}): ${value}`);
}


async function testFacebookGraphApi() {
    const facebookApiClients = await createFacebookApiClients();
    const fpHubFacebookApiClient = facebookApiClients.get(accountKey);

    if (!fpHubFacebookApiClient) {
        throw new Error(
            `Facebook-акаунт "${accountKey}" не знайдено`
        );
    }

    console.log("\n########################################");
    console.log("# Facebook Graph API — FP Hub");
    console.log("########################################");
    console.log(`Ключ акаунта: ${accountKey}`);

    const tokenStatus = await fpHubFacebookApiClient.checkAccessToken();

    printSection("СТАТУС ACCESS TOKEN");
    console.log(
        tokenStatus.working
            ? "✅ Access token працює"
            : "❌ Access token не працює"
    );

    if (!tokenStatus.working) {
        console.table([tokenStatus.error]);
        return;
    }

    const me = tokenStatus.user;

    printSection("КОРИСТУВАЧ");
    console.table([me]);

    const permissions = await fpHubFacebookApiClient.getPermissions();

    printSection("PERMISSIONS");
    printPermissionGroup("✅ Надані", permissions.granted);
    printPermissionGroup("❌ Відхилені", permissions.declined);
    printPermissionGroup("⌛ Прострочені", permissions.expired);

    if (permissions.other.length > 0) {
        console.log("Інші значення:");
        console.table(permissions.other);
    }

    const adAccounts = await fpHubFacebookApiClient.getAdAccounts();

    printSection(`РЕКЛАМНІ АКАУНТИ (${adAccounts.length})`);

    if (adAccounts.length > 0) {
        console.table(adAccounts);
    } else {
        console.log("Доступних рекламних акаунтів немає");
    }

    const pages = await fpHubFacebookApiClient.getPages();

    printSection(`FAN PAGES (${pages.length})`);

    if (pages.length > 0) {
        console.table(
            pages.map((page) => ({
                id: page.id,
                name: page.name,
                category: page.category,
                tasks: page.tasks.join(", "),
                hasPageAccessToken: Boolean(page.pageAccessToken),
            }))
        );
    } else {
        console.log("Доступних fan pages немає");
    }

    printSection("ПІДСУМОК");
    console.table([{
        userId: me.id,
        userName: me.name,
        grantedPermissions: permissions.granted.length,
        adAccounts: adAccounts.length,
        fanPages: pages.length,
    }]);
}


testFacebookGraphApi().catch((error) => {
    printSection("ПОМИЛКА ПЕРЕВІРКИ");
    console.table([{
        message: error.message,
        code: error.code,
        httpStatus: error.httpStatus,
        graphCode: error.graphCode,
        graphSubcode: error.graphSubcode,
    }]);
    process.exitCode = 1;
});
