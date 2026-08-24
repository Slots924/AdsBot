# Facebook Graph API

## Puppeteer: пости особистого профілю з вибраними датами

`publishFacebookPersonalProfileMediaPostsWithDates(page, options)` обробляє
кожен пост окремо в одній вкладці: публікує медіа через
`publishFacebookPersonalProfileMediaPost` з `capturePostUrl: false`, відкриває
першу картку стрічки `[aria-posinset="1"]` кліком по першому
`a[href*="?__cft__[0]="]`, зчитує `postUrl` з адреси вкладки або з відкритого
діалогу і одразу змінює дату через `changeFacebookPersonalProfilePostDate`
без повторної навігації (`postUrl: null`, `closePostDialog: true`).

```js
const result = await publishFacebookPersonalProfileMediaPostsWithDates(page, {
    posts: [
        {
            mediaPaths: ["C:/images/one.jpg"],
            targetDate: "04/22/2020",
        },
        {
            mediaPaths: ["C:/images/two.jpg", "C:/images/three.jpg"],
            targetDate: "2020-05-10",
        },
    ],
    timeout: 90000,
    logger,
    onProgress,
});
```

Дати підтримують `MM/DD/YYYY`, `YYYY-MM-DD` та англійський формат
`Month D, YYYY`. Екшен вводить `MM/DD/YYYY` безпосередньо в React-combobox,
натискає `Enter`, перевіряє відформатовану дату в полі і натискає `Done`.
Після `Done` дата вважається зміненою, timestamp у вікні поста не
перевіряється. Далі вікно поста закривається. Час поста не змінюється.

Якщо публікація неуспішна або перший пост стрічки не відкрився, цикл
зупиняється, щоб не клікнути чужу стару картку. `datePhaseStarted`
стає `true`, коли починається перша зміна дати відкритого поста, а не після
збору всіх URL. Основні статуси: `COMPLETED`, `PUBLISH_PARTIAL`,
`FIRST_FEED_POST_OPEN_FAILED`, `POST_URL_CAPTURE_FAILED`,
`DATE_CHANGE_PARTIAL`, `INVALID_INPUT`, `ERROR`. Звіт містить
`publishedCount`, `capturedUrlCount`, `dateChangedCount`, `datePhaseStarted`
та журнал `items` для кожного поста.

Звичайний `publishFacebookPersonalProfileMediaPost` зберігає попередню
поведінку. За опції `capturePostUrl: true` він додатково повертає `postUrl`,
`postId` і `postUrlCaptured`.

## Puppeteer: About особистої сторінки

`fillFacebookPersonalProfileAbout(page, options)` з англомовної домашньої
сторінки `/me` відкриває About і заповнює біо, роботу та коледж. Помилку
назовні не кидає: повертає звіт по кожному полю.

```js
const result = await fillFacebookPersonalProfileAbout(page, {
    fields: {
        bio: "I hike on weekends",
        work: { company: "Acme", position: "Engineer" },
        education: "Harvard University",
    },
    timeout: 90000,
    logger,
    onProgress,
});
```

`bio` обробляється завжди: є текст — записати або оновити, ключа немає або
рядок порожній — стерти наявне. `work` береться лише коли є і `company`, і
`position`; інакше поле `SKIPPED`. Якщо вже є `Edit Workplace` або
`Edit college`, другий запис не додається. `{}` валідний і лише чистить біо.

Після Save успіх поля визначається тим, що форма закрилась і поля вводу
зникли. Точний збіг збереженого тексту більше не перевіряється.

Для Company, Position і College name: після вводу чекаємо підказки тричі
по 5 с. Якщо списку немає — стираємо по одній літері з паузою 3 с, поки
не з’явиться option або не закінчаться букви. Якщо списку так і немає,
поле (компанія, посада чи університет) вважається проваленим.

`success` true лише коли жоден requested-крок не `FAILED`. Основні статуси
екшену: `COMPLETED`, `PARTIAL`, `INVALID_INPUT`, `ERROR`. Статуси полів:
біо `UPDATED` / `CLEARED` / `FAILED`, робота й освіта `FILLED` / `SKIPPED` /
`FAILED`. Причини skip: `MISSING_INPUT`, `INCOMPLETE_WORK`, `ALREADY_EXISTS`.

## Контракти workspace і runtime tracking

`FacebookGraphApi.getAdPixels(adAccountId)` проходить cursor-пагінацію `/{act_id}/adspixels` і повертає лише `{ id, name }`. Page token, access token, cookie та proxy-поля не потрапляють у backend facade або renderer.

`preflightLeadCampaign()` і `createLeadCampaign()` тепер приймають `pixelId` та `utm` як runtime-параметри. Campaign template v5 містить лише targeting, placements, devices, DSA, enhancements і budget sharing. Старі `pixel`/`utm` під час нормалізації шаблону відкидаються й не переносяться до глобальних defaults.

GUI-контракти: `workspace:client-load`, `pages:posts-with-links`, `pages:posts-delete`, `pages:post-delete`, `ads:pixels-list` та `creative-launch:start/get/retry`. Creative launch не викликає campaign/comments як вкладені background tasks: обидві гілки запускаються безпосередньо всередині parent runner і тому не створюють deadlock глобальної черги.

## Backend facade для GUI

`FacebookBackendService` є рекомендованою точкою входу для майбутнього
інтерфейсу. GUI зберігає тільки ключ вибраного акаунта й передає його в кожний
виклик:

```js
import FacebookBackendService
    from "./facebook/services/FacebookBackendService.js";

const facebookBackend = await FacebookBackendService.create();
let selectedAccountKey = "fp_hub";

const accounts = await facebookBackend.getAccounts();
const fanPages = await facebookBackend.getFanPages(
    selectedAccountKey
);
```

`getAccounts()` окремо перевіряє кожний профіль через `/me`. Статус `active`
означає робочий token, `inactive` — підтверджений Meta invalid token, а `error` —
мережеву, proxy або іншу API-помилку. Помилка одного профілю не ламає список.
Результат не містить token, cookie, User-Agent або proxy.

`getFanPages(accountKey)` вибирає клієнт із Map саме за переданим ключем. Тому
після зміни `selectedAccountKey` наступний запит автоматично використовує token,
cookie та User-Agent іншого Facebook-профілю. Facade не має глобального
«активного акаунта».

У список потрапляють лише опубліковані фанпейджі з Page token і task
`CREATE_CONTENT`, `MANAGE`, `PROFILE_PLUS_CREATE_CONTENT`,
`PROFILE_PLUS_MANAGE` або `PROFILE_PLUS_FULL_CONTROL`, для яких контрольний
Page GET завершився успішно.
Graph 400/403 окремої фанпейджі приховує тільки її; мережева чи proxy-помилка
перериває завантаження списку.

Креатив і пост готуються так:

```js
const preparedCreative = await facebookBackend.prepareCreative({
    geo: "HU",
    creativeName: "138",
    siteUrl: "https://example.com/offer",
});

const post = await facebookBackend.publishPost({
    accountKey: selectedAccountKey,
    pageId: "123456789",
    message: preparedCreative.creative,
    imagePath: "C:/images/post.jpg",
});
```

`publishPost()` приймає текст, одну локальну картинку або обидва значення.
Підтримуються JPG, JPEG, PNG і WEBP. Усередині використовується наявний
`publishPagePost()`, який не повторює невизначений POST і перевіряє створений
пост контрольним GET-запитом.

Для Electron GUI над цим facade працює `AdsBotGuiService`. Він додає
`getAdAccounts(accountKey)`, повний сценарій підготовки й публікації креативу та
не дозволяє Graph API-дії для профілю, статус якого не є `active`.

Підсистема `facebook/api` виконує запити до Graph API, а workflow
`publishPagePost` додає контрольовану публікацію постів на фанпейджі. Вона не
залежить від AdsPower і не запускає браузер. Кожен Facebook-акаунт має власні
access token, session cookies та User-Agent, але всі клієнти використовують один
спільний `ProxyHttpClient`.

## Конфігурація акаунтів

Реальні акаунти зберігаються в `data/facebookApi/accounts.json`:

```json
{
  "accounts": [
    {
      "accountKey": "account-001",
      "name": "",
      "facebookUserId": "",
      "userAgent": "Mozilla/5.0 (...) Chrome/000.0.0.0 Safari/537.36",
      "accessToken": "REPLACE_WITH_ACCESS_TOKEN",
      "cookie": "c_user=REPLACE; xs=REPLACE",
      "metadata": {}
    }
  ]
}
```

Обов'язкові поля:

- `accountKey` — унікальний внутрішній ключ для вибору клієнта;
- `userAgent` — User-Agent конкретного Facebook-акаунта;
- `accessToken` — user access token;
- `cookie` — готовий рядок session cookies того самого акаунта у форматі `name=value; name=value`.

`name`, `facebookUserId` і `metadata` зарезервовані для подальшої автоматизації та можуть бути порожніми. Фабрика читає конфіг, але ніколи його не перезаписує.

Клієнт використовує захардкоджений базовий URL `https://graph.facebook.com/v26.0`. Змінна оточення для версії API не потрібна.

## Створення клієнта

```js
import "dotenv/config";

import createFacebookApiClients from "./facebook/api/createFacebookApiClients.js";

const facebookApiClients = await createFacebookApiClients();
const selectedFacebookApiClient = facebookApiClients.get("account-001");

if (!selectedFacebookApiClient) {
    throw new Error("Facebook-акаунт не знайдено");
}
```

Фабрика повертає `Map`, де ключем є `accountKey`. Всі елементи Map використовують один екземпляр proxy client і тому бачать одну спільну активну проксі.

## Методи

| Метод | Результат | Призначення |
| --- | --- | --- |
| `checkAccessToken()` | `{ working, user?, error? }` | Перевіряє token через `/me`. OAuth code 190 повертається як `working: false`. |
| `getMe()` | `{ id, name }` | Повертає користувача, якому належить token. |
| `getPermissions()` | `{ granted, declined, expired, other }` | Групує permissions за статусом. |
| `getAdAccounts()` | `Array` | Повертає всі доступні рекламні акаунти, включно з UTC offset і DSA defaults. Денний spend та `adtrust_dsl` тут навмисно не запитуються. |
| `getAdCampaigns(adAccountId)` | `Array` | Повертає ACTIVE і PAUSED кампанії РК. |
| `getAdCampaignInsights(adAccountId, datePreset)` | `Array` | Повертає campaign-level spend та actions за Meta date preset. |
| `getPages()` | `Array` | Повертає всі fan pages, tasks і `pageAccessToken`. |
| `getAvailablePages()` | `Array<{id, name, pictureUrl}>` | Перевіряє доступність, publish tasks і статус фанпейджів та повертає список з avatar URL, але без токенів. |
| `getPageList({force})` | `Array<{id, name, pictureUrl}>` | Легко оновлює список через `id,name,tasks,access_token` без перевірки деталей кожної Page та без завантаження avatar. Токени назовні не повертає. |
| `getPageDetails({pageId})` | `{id, name, pictureUrl}` | За прямою ручною дією оновлює дані та локальну копію avatar однієї Page. |
| `getFanPageById(pageId)` | `object \| null` | Перевіряє фанпейджу й повертає її Page token лише для внутрішньої публікації. |
| `getPagePosts({pageId, limit})` | `Array` | Повертає 10 найновіших опублікованих постів із безпечними даними для прев’ю. |
| `getLatestPagePostsWithLinks({pageId, limit})` | `Array` | Серед 10 найновіших опублікованих постів повертає ті, що містять HTTP(S)-посилання саме в тексті. |
| `getPagePostsSignature({pageId, limit})` | `{count, postIds}` | Легко читає лише `id,message,is_published`, щоб порівняти URL-пости без завантаження фотографій і заміни кешу. |
| `deletePagePosts({pageId, posts})` | `{ deleted, failed }` | Послідовно видаляє передані canonical post ID цієї фанпейджі та повертає частковий результат. |
| `createPageTextPost(options)` | `{ postId }` | Публікує текстовий пост через `/feed`. |
| `createPagePhotoPost(options)` | `{ postId, photoId }` | Публікує одну фотографію через `/photos`. |
| `getPagePost(options)` | `object` | Отримує пост за ID для підтвердження публікації. |
| `preflightLeadCampaign(options)` | `object` | Перевіряє `ads_management`, РК, сторінку, пост, Pixel, targeting і campaign payload через `validate_only`. |
| `createLeadCampaign(options, onProgress)` | `object` | Поетапно створює website lead campaign, creative, ad sets та ads; у ручному режимі campaign PAUSED, а ad sets та ads ACTIVE. |
| `deleteCampaignDraft(objects, onProgress)` | `{ deleted, failed }` | Видаляє тільки Graph ID із журналу конкретної спроби. |

Приклад:

```js
const tokenStatus = await selectedFacebookApiClient.checkAccessToken();

if (!tokenStatus.working) {
    console.error("Access token не працює");
    return;
}

const me = await selectedFacebookApiClient.getMe();
const permissions = await selectedFacebookApiClient.getPermissions();
const adAccounts = await selectedFacebookApiClient.getAdAccounts();
const pages = await selectedFacebookApiClient.getPages();
```

`getAdAccounts()` і `getPages()` автоматично проходять усі сторінки Graph API через cursor `after`. Код не використовує абсолютний `paging.next`, щоб access token випадково не потрапив до логів разом із URL.

`getAdAccounts()` читає `timezone_offset_hours_utc`, але не додає важкий вкладений
`insights.date_preset(today){spend}` і не запитує `adtrust_dsl`. Spend кампаній
надалі завантажується окремим `getAdCampaignInsights()` лише для вибраної РК.

`getPagePosts()` одним read-only запитом читає перші 10 записів
`/{page-id}/published_posts` і сортує їх від найновішого до найстарішого.
Thumbnail URL дозволяється лише з HTTPS-доменів `fbcdn.net`; Page access token у
результат не потрапляє.

`getLatestPagePostsWithLinks()` не змінює контракт `getPagePosts()`. Метод
запитує рівно 10 найновіших публікацій за стандартного `limit`, сортує цю
вибірку від нової до старої й лише після цього відкидає записи без `http://` або
`https://` у тексті. Тому результат може містити менше ніж 10 постів. Старіші
публікації для доповнення результату не завантажуються, а посилання лише в
attachments не враховуються.

`deletePagePosts()` приймає масив рядків або об'єктів із `id`/`postId`, прибирає
дублікати та видаляє записи послідовно. Дозволені лише canonical ID формату
`pageId_postId`, що належать переданій фанпейджі. Метод не повторює запит після
невизначеної мережевої помилки й повертає окремі масиви `deleted` та `failed`.

`getAdCampaigns()` і `getAdCampaignInsights()` також проходять усі сторінки
через cursor `after`. Insights запитуються з `level=campaign`; GUI використовує
лише агрегований action type `lead`, не сумуючи його з Pixel або form-підтипами.
Підтримувані періоди: `today`, `yesterday`, `last_7d`, `last_30d`, `maximum`.

## Створення website lead-кампаній

Створення реклами виконується тільки через `FacebookGraphApi`. Renderer та IPC
не отримують access token, cookie, Page token або proxy. Потрібен permission
`ads_management`.

GUI ставить create/retry/cleanup у єдину фонову write-чергу й одразу повертає
`taskId`. Це не змінює контракт `FacebookGraphApi`: один виклик
`createLeadCampaign()` і надалі послідовно створює об’єкти та передає етапи в
`onProgress`. При перериванні відомі Graph ID зберігаються для контрольованого
retry або cleanup.

`preflightLeadCampaign()` перевіряє активність РК, доступ до сторінки, поста й
Pixel, зовнішнє посилання у пості, валюту та timezone. Campaign payload
перевіряється через `execution_options=["validate_only"]`. Ad set та ad залежать
від реальних parent ID, тому для них `validate_only` виконується поетапно після
створення відповідного parent. Campaign створюється PAUSED; коли
`createPaused=true`, ad sets та ads отримують власний статус ACTIVE, але не
показуються через effective status батьківської campaign. Після ручної
перевірки достатньо активувати campaign. Для `createPaused=false` дочірні
об’єкти залишаються PAUSED до успішного завершення всіх кроків і лише потім
активуються разом із campaign.

Майстер передає canonical `pageId_postId` вибраного поста. Належність поста
вибраній сторінці, його опублікований стан і наявність зовнішнього website URL
повторно перевіряються безпосередньо перед preflight.

Для сторінок нового типу право рекламування може повертатися як
`PROFILE_PLUS_ADVERTISE`; preflight приймає його нарівні з класичним `ADVERTISE`.

`createLeadCampaign()` використовує `OUTCOME_LEADS`,
`OFFSITE_CONVERSIONS`, Pixel event `LEAD`, бюджети ad set і ручний targeting з
`advantage_audience=0`. Creative посилається на готовий `object_story_id`,
отримує `url_tags` та явні `OPT_OUT` для відомих creative enhancements.
За наявності обмежень шаблону targeting також отримує `device_platforms` і
`user_os`; порожні масиви означають усі пристрої та всі мобільні ОС.

Для existing Page post поле `destination_type` навмисно не передається. Meta
Ads Manager так само залишає його `UNDEFINED`, а website-конверсію визначає
через `OFFSITE_CONVERSIONS` і promoted object із Pixel event `LEAD`. Явне
`destination_type=WEBSITE` робить existing photo post несумісним з ad set і
може повертати Meta `100/1815676`.

Для DSA спочатку використовуються `dsaBeneficiary` і `dsaPayor` шаблону, а
порожні значення доповнюються офіційними `default_dsa_beneficiary` та
`default_dsa_payor` рекламного акаунта. Якщо targeting містить країну ЄС/ЄЕЗ,
відсутність resolved beneficiary або payor блокує preflight. Resolved значення та
джерела повертаються у `preflight.dsa`, передаються як `dsa_beneficiary` і
`dsa_payor` у кожний ad set, проходять `validate_only` та контрольний read-back.
Випадкові назви не створюються.

Сценарій залишається суто website-only завдяки `OFFSITE_CONVERSIONS` і Pixel
event `LEAD`; payload не надсилає WhatsApp або messaging-поля. Якщо Meta
повертає destination/WhatsApp setup error, для діагностики слід вручну повторити
аналогічне налаштування в Ads Manager із WhatsApp і зберегти точний текст помилки
або скриншот. Це не вмикає автоматичний WhatsApp fallback у програмі.

При частковій помилці Error містить безпечні поля `stage`, `itemIndex` і
`createdObjects`. Повторна спроба приймає ці ID та створює лише відсутні
елементи. API-записи не повторюються автоматично після невизначеної мережевої
помилки.

## Публікація поста

Готовий сценарій знаходиться у `facebook/workflows/publishPagePost.js`. Він сам
знаходить фанпейджу за ID, бере її Page access token, вибирає `/feed` або
`/photos`, а потім перевіряє створений пост контрольним GET-запитом.

```js
import publishPagePost from "./facebook/workflows/publishPagePost.js";

const result = await publishPagePost({
    facebookApiClient: selectedFacebookApiClient,
    pageId: "123456789",
    message: "Текст поста",
    image: {
        buffer: imageBuffer,
        filename: "photo.jpg",
        contentType: "image/jpeg",
    },
});
```

Поле `image` необов'язкове. Підтримується текст, одна фотографія або одна
фотографія з текстом. Успішний результат містить `postId`, `permalinkUrl`,
`createdTime` і `verified: true`.

POST-запит не повторюється після мережевої помилки, бо відповідь могла
загубитися вже після створення поста. У цьому випадку повертається
`FACEBOOK_POST_OUTCOME_UNKNOWN`, а автоматичний повтор міг би створити дублікат.

## Заголовки

Кожен запит містить лише прикладні заголовки:

- `Authorization: Bearer ...`;
- `Cookie` із конфігурації акаунта;
- `User-Agent` із конфігурації акаунта;
- `Accept: application/json`.

Клієнт не додає `sec-fetch-*`, `sec-ch-ua`, `Origin`, `Referer` або `X-Requested-With`. Системні `Host`, `Connection` та `Accept-Encoding`, які додає HTTP-стек Node.js, є нормальними транспортними заголовками.

## Помилки й токени

Конфіг `data/facebookApi/accounts.json` змінюється лише через
`FacebookAccountManager`. Він створює акаунти з унікальним `accountKey`,
частково оновлює `userAgent`, `accessToken` і cookies та архівує записи без
фізичного видалення. Архівовані записи не перетворюються на
`FacebookGraphApi`-клієнти.

Cookie input приймає готовий Cookie header, JSON-масив із AdsPower або об’єкт
із масивом `cookies`. Під час запису залишаються лише потрібні cookies домену
`facebook.com`; інші домени й зайві cookie-поля відкидаються. IPC повертає лише
ознаки наявності секретів, але не їх значення.

- Graph API errors перетворюються на Error з `code="FACEBOOK_API_ERROR"` та полями `httpStatus`, `graphCode`, `graphSubcode`, `graphType`, `graphUserTitle`, `graphUserMessage`.
- Вичерпання проксі повертає `code="PROXY_POOL_EXHAUSTED"`.
- HTTP-помилки Meta не запускають proxy failover, окрім HTTP 407 від проксі.
- Access tokens, session cookies і Page access tokens не можна виводити в логи.

Токени, отримані з DOM Ads Manager, працюють разом з активними session cookies того самого Facebook-акаунта. Якщо cookies протухли або сесію завершено, їх потрібно оновити в локальному `accounts.json`. Повний `debug_token` вимагає credentials Meta App, який видав token, тому в першій версії не підтримується.

## Пересетаплення фанпейджа з папки

`FacebookBackendService.rebuildPageFromFolder()` повністю переоформлює Page:
зберігає snapshot старих object ID, ставить нові avatar та cover, приховує
створені Meta stories, видаляє старі фото й пости та створює фото-пости з
`backdated_time`. Операція незворотна й виконується лише після повної локальної
перевірки папки та діапазону дат.

У корені папки використовуються такі назви:

- `1.*` — пріоритетне фото профілю;
- `2.*` — пріоритетна обкладинка;
- решта JPG, JPEG, PNG або WEBP — фото-пости без тексту.

Якщо позначене фото не відповідає вимогам розміру, workflow вибирає інше
придатне фото, а невикористаний файл публікує як звичайний пост. Вибір файлів,
дати, snapshot і завершені мутації зберігаються в
`data/page-rebuild-jobs.json`; токени та cookies до журналу не потрапляють.

Для ручного небезпечного запуску:

```powershell
node scripts/manual/rebuildPageFromFolder.js fp_hub PAGE_ID C:\images\page 2024-01-01
```

Дата наприкінці потрібна лише тоді, коли Meta не повертає `created_time` Page.
Автоматичні тести ніколи не запускають цей сценарій проти реального Facebook.

## Ручна перевірка

Після заповнення `.env`, `accounts.json` і `proxies.json` вкажіть потрібний `accountKey` у `scripts/manual/facebookGraphApi.js` та запустіть:

```powershell
node scripts/manual/facebookGraphApi.js
```

Для ручної публікації відкрийте `scripts/manual/publishPagePost.js` і заповніть
налаштування на початку файла:

```js
const accountKey = "fp_hub";
const fanPageId = "ID_ФАНПЕЙДЖІ";
const geo = "HU";
const creativeName = "138";
const siteUrl = "https://example.com/offer";
const imagePath = "C:/path/photo.jpg";
```

Профіль `fp_hub` уже вибраний у тесті. Після заповнення запустіть:

```powershell
node scripts/manual/publishPagePost.js
```

Окремий read-only сценарій для пошуку вимкнених рекламних акаунтів профілю
`fp_hub`:

```powershell
node scripts/manual/disabledAdAccounts.js
```

Сценарій відбирає акаунти з `accountStatus === 2` і показує `disableReason`,
Business, власника та основні фінансові поля.
`disableReason` є технічною категорією Meta й не завжди містить детальний текст
конкретного порушення.

Сценарій не змінює дані Facebook і не виводить access tokens або session cookies. Він виконує реальні запити, тому автоматично не запускається.

### Live validation створення кампанії

`npm run test:campaign:live` виконує реальні read-only запити та один Meta
`validate_only` для campaign payload. Сценарій не створює campaign, ad set,
creative або ad і не запускається з `test:campaign` чи `test:all`.

Перед ручним запуском задайте явний дозвіл і тестові ресурси:

```powershell
$env:ADSBOT_ALLOW_LIVE_CAMPAIGN_VALIDATION = "1"
$env:ADSBOT_CAMPAIGN_ACCOUNT_KEY = "fp_hub"
$env:ADSBOT_CAMPAIGN_AD_ACCOUNT_ID = "act_123"
$env:ADSBOT_CAMPAIGN_PAGE_ID = "123"
$env:ADSBOT_CAMPAIGN_POST_ID = "123_456"
$env:ADSBOT_CAMPAIGN_PIXEL_ID = "789"
$env:ADSBOT_CAMPAIGN_COUNTRIES = "HU"
npm run test:campaign:live
```

Для європейської аудиторії використовуються Meta defaults DSA. За потреби їх
можна перевизначити через `ADSBOT_CAMPAIGN_DSA_BENEFICIARY` та
`ADSBOT_CAMPAIGN_DSA_PAYOR`. Бюджет за замовчуванням — 5 одиниць валюти РК;
його можна змінити через `ADSBOT_CAMPAIGN_DAILY_BUDGET`.
