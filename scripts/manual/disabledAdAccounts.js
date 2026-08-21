import "dotenv/config";

import createFacebookApiClients from "../../facebook/api/createFacebookApiClients.js";


// Ключ Facebook-профілю, для якого виконується ручна перевірка.
const accountKey = "fp_hub";

const DISABLED_ACCOUNT_STATUS = 2;

const disableReasons = new Map([
    [0, "Причину не вказано"],
    [1, "Порушення рекламної політики або перевірка цілісності реклами"],
    [2, "Акаунт перебуває на перевірці рекламної політики"],
    [3, "Ризик або проблема, пов'язана з оплатою"],
    [4, "Вимкнений сірий акаунт"],
    [5, "Акаунт перебуває на додатковій перевірці Meta"],
    [6, "Перевірка цілісності бізнесу"],
    [7, "Рекламний акаунт закрито назавжди"],
    [8, "Неактивний акаунт реселера"],
    [9, "Акаунт вимкнено через тривалу неактивність"],
    [10, "Обмеження UMG"],
    [11, "Порушення політики цілісності Business Manager"],
    [12, "Неправдиве представлення рекламного акаунта"],
    [13, "Відсутній ідентифікатор юридичної особи"],
]);


function printTitle(title) {
    console.log(`\n${"═".repeat(72)}`);
    console.log(title);
    console.log("═".repeat(72));
}


function valueOrDash(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    return value;
}


function getDisableReasonLabel(reasonCode) {
    return disableReasons.get(Number(reasonCode))
        ?? `Невідома причина Meta (код ${valueOrDash(reasonCode)})`;
}


function printDisabledAccount(account, index) {
    printTitle(`⛔ ${index + 1}. ${account.name || "Без назви"}`);

    console.table([{
        "ID акаунта": account.accountId,
        "Graph ID": account.id,
        "Статус": `${account.accountStatus} (DISABLED)`,
        "Код причини": valueOrDash(account.disableReason),
        "Причина": getDisableReasonLabel(account.disableReason),
    }]);

    console.log("\nОсновна інформація:");
    console.table([{
        "Business": account.business?.name ?? "—",
        "Business ID": account.business?.id ?? "—",
        "Owner ID": valueOrDash(account.owner),
        "Валюта": valueOrDash(account.currency),
        "Часовий пояс": valueOrDash(account.timezoneName),
        "Створено": valueOrDash(account.createdTime),
    }]);

    console.log("\nФінансові значення (як повернув Graph API):");
    console.table([{
        "Витрачено": valueOrDash(account.amountSpent),
        "Баланс": valueOrDash(account.balance),
        "Ліміт витрат": valueOrDash(account.spendCap),
    }]);

    console.log(
        "\n"
        + "Примітка: disable_reason — це технічна категорія Meta; "
        + "детальний текст порушення API може не повертати."
    );
}


async function testDisabledAdAccounts() {
    const facebookApiClients = await createFacebookApiClients();
    const fpHubFacebookApiClient = facebookApiClients.get(accountKey);

    if (!fpHubFacebookApiClient) {
        throw new Error(`Facebook-акаунт "${accountKey}" не знайдено`);
    }

    printTitle("Facebook Graph API — вимкнені рекламні акаунти");
    console.log(`Профіль: ${accountKey}`);
    console.log("Отримую доступні рекламні акаунти…");

    const adAccounts = await fpHubFacebookApiClient.getAdAccounts();
    const activeAccounts = adAccounts.filter(
        (account) => Number(account.accountStatus) === 1
    );
    const disabledAccounts = adAccounts.filter(
        (account) => Number(account.accountStatus) === DISABLED_ACCOUNT_STATUS
    );

    console.table([{
        "Усього доступно": adAccounts.length,
        "Активних": activeAccounts.length,
        "Вимкнених": disabledAccounts.length,
        "Інших статусів": adAccounts.length
            - activeAccounts.length
            - disabledAccounts.length,
    }]);

    if (disabledAccounts.length === 0) {
        console.log("\n✅ Вимкнених рекламних акаунтів не знайдено.");
        return;
    }

    disabledAccounts.forEach(printDisabledAccount);

    printTitle("Підсумок вимкнених акаунтів");
    console.table(
        disabledAccounts.map((account) => ({
            name: account.name || "—",
            accountId: account.accountId,
            disableReasonCode: valueOrDash(account.disableReason),
            disableReason: getDisableReasonLabel(account.disableReason),
            business: account.business?.name ?? "—",
        }))
    );
}


testDisabledAdAccounts().catch((error) => {
    printTitle("Помилка перевірки");
    console.table([{
        message: error.message,
        code: error.code ?? "—",
        httpStatus: error.httpStatus ?? "—",
        graphCode: error.graphCode ?? "—",
        graphSubcode: error.graphSubcode ?? "—",
    }]);
    process.exitCode = 1;
});
