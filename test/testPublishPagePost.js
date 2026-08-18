import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import createFacebookApiClients from "../facebook/api/createFacebookApiClients.js";
import publishPagePost from "../facebook/workflows/publishPagePost.js";


const accountKey = "fp_hub";

// Вставте сюди ID фанпейджі, на якій потрібно створити пост.
const fanPageId = "122101154528004114";

// Текст між зворотними лапками може містити будь-яку кількість рядків.
const postText = `Chtěla mého ptáka

Po 20 letech manželství se žena rozhodla, že ji sex už nezajímá, a dostat ji do postele začalo být skoro nemožné. Je mi 48 a po intimní stránce jsem úplně v pohodě. Jenže doma je to jak na poušti, už tam chybí jen velbloudi. Dřív jsme spolu spali aspoň jednou za měsíc, ale poslední dva roky - naprosté ticho. Zkoušel jsem všechno možné, romantiku, dárky - k ničemu. Sedím večer, koukám na ni a dochází mi, že ten vlak už prostě ujel. A popravdě, konkrétně na ni už stejně moc chuť nemám.

Jednou jsme byli s kamarády na rybách a přišla řeč i na vztahy. Jeden mi říká: "Proč se tak trápíš? Seznamka a máš po problému." Říkám mu: "Zkoušel jsem. Všechny si chtějí jen povídat a ptají se na plány do budoucna." A on na to: "Tak chodíš na špatné stránky! Tady máš odkaz https://love-in-hurt.cyou/CJ138Z. Tam fakt mladé holky hledají starší chlapy. Bez závazků a dlouhých vztahů. Prostě chtějí sex!" Samozřejmě jsem tomu moc nevěřil, ale když se druhý den ukázalo, že je žena zase strašně unavená, zalezl jsem do svého pokoje a na tom webu se zaregistroval.

Dal jsem tam normální fotky a napsal rovnou, že hledám mladší holku na pravidelné schůzky. Filtr - maximálně 26 let a do 30 km. Ani ne za 50 minut mi napsala dvacetiletá holka, studentka třetího ročníku. Fotky - naprostá bomba: dlouhé vlasy, sportovní postava a drzý úsměv. "Ahoj. Už dlouho jsem to chtěla zkusit se zkušenějším. Máš dneska čas?" Předstíral jsem, že mě urgentně volají do práce, a vyrazil jsem.

Přijel jsem k ní do pronajatého bytu. Otevřela jen v županu a hned se ke mně přitiskla. "Už jsem úplně mokrá," zašeptala. Ani jsme nedošli k posteli. Hned na chodbě jsem jí vyhrnul župan - pod ním neměla vůbec nic. Opřela se o zeď, sama mě navedla a chtěla to tvrdě. Sténala tak hlasitě, že to snad museli slyšet i sousedi. Pak jsme pokračovali v kuchyni, ve sprše a nakonec v ložnici až do rána. Několikrát se udělala a nakonec sama chtěla, abych se jí udělal na obličej. Pak tam ležela, usmívala se a vypadala naprosto spokojeně... 😏

Teď se vídáme 2-3krát týdně. Manželka nic netuší a já mám zase pocit, že žiju. Jako by mi bylo znovu třicet.`;

// Використовуйте прямі слеші, наприклад: C:/Images/facebook-post.jpg
// Залиште порожнім, якщо потрібно опублікувати тільки текст.
const imagePath = "C:/Users/Darkness/Downloads/14.jpeg";


function getImageContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = new Map([
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".png", "image/png"],
        [".webp", "image/webp"],
    ]);

    return contentTypes.get(extension) ?? null;
}


async function loadTestImage(filePath) {
    if (!filePath) {
        return undefined;
    }

    const absolutePath = path.resolve(filePath);
    const contentType = getImageContentType(absolutePath);

    if (!contentType) {
        throw new Error("Тест підтримує JPG, PNG або WEBP");
    }

    return {
        buffer: await readFile(absolutePath),
        filename: path.basename(absolutePath),
        contentType,
    };
}


async function testPublishPagePost() {
    if (!fanPageId.trim()) {
        console.log(
            "Публікацію не виконано: вкажіть fanPageId на початку файла."
        );
        return;
    }

    const facebookApiClients = await createFacebookApiClients();
    const fpHubFacebookApiClient = facebookApiClients.get(accountKey);

    if (!fpHubFacebookApiClient) {
        throw new Error(`Facebook-акаунт "${accountKey}" не знайдено`);
    }

    const image = await loadTestImage(imagePath.trim());

    console.log("Доступні фанпейджі:");
    console.table(await fpHubFacebookApiClient.getAvailablePages());
    console.log(`Публікуємо на фанпейджу: ${fanPageId}`);

    const result = await publishPagePost({
        facebookApiClient: fpHubFacebookApiClient,
        pageId: fanPageId,
        message: postText,
        image,
    });

    console.log("Пост успішно опубліковано та перевірено:");
    console.table([result]);
}


testPublishPagePost().catch((error) => {
    console.error("Помилка публікації:");
    console.table([{
        message: error.message,
        code: error.code ?? "—",
        httpStatus: error.httpStatus ?? "—",
        graphCode: error.graphCode ?? "—",
        graphSubcode: error.graphSubcode ?? "—",
        postId: error.postId ?? "—",
    }]);
    process.exitCode = 1;
});
