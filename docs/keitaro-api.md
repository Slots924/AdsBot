# Keitaro Admin API

Усі запити до Keitaro йдуть лише через клас `Keitaro` у `classes/Keitaro.js`.
Сервіси, GUI і `index.js` не викликають Admin API напряму.

## Налаштування

Додайте до локального `.env`:

```env
KEITARO_API_URL=https://your-tracker.example.com
KEITARO_API_KEY=REPLACE_WITH_KEITARO_API_KEY
```

`KEITARO_API_URL` — адреса трекера без шляху `/admin_api/v1`. Клас сам додає
`/admin_api/v1` до кожного запиту. `KEITARO_API_KEY` є секретом: його не можна
додавати в Git, документацію, тести або логи.

Авторизація: заголовок `Api-Key`.

## Використання

```js
import "dotenv/config";

import Keitaro from "./classes/Keitaro.js";

const keitaro = new Keitaro();
const groups = await keitaro.listAllCampaignGroups();
const report = await keitaro.buildReport({
    range: {
        from: "2026-08-01",
        to: "2026-08-27",
        timezone: "Europe/Kyiv",
    },
    dimensions: ["campaign_id"],
    metrics: ["clicks", "conversions", "revenue"],
});
```

Публічні методи не викликають Axios напряму. Усі HTTP-запити йдуть через
`request()`. Одночасно виконується обмежена кількість запитів (стандартно 20,
змінюється в налаштуваннях Keitaro, `setConcurrency()`). Повтор при 429 зараз
вимкнений: помилка не зупиняє чергу, йде наступний запит. Увімкнути пізніше:
`retryOnRateLimit: true`.

## Пагінація списків

Не можна припускати, що кожен endpoint Keitaro підтримує `limit` і `offset`.
Перед використанням загального `listAll()` перевірте конкретний endpoint двома
запитами: `offset: 0` та `offset: limit`. Якщо перші ID збігаються, endpoint
повертає весь список одразу; повторні запити лише дублюватимуть дані й
сповільнюватимуть GUI.

У поточному Keitaro перевірено:

| Ресурс | Поведінка | Метод у проєкті |
| --- | --- | --- |
| Кампанії (`/campaigns`) | `offset` працює, сторінки мають різні ID | `listAllCampaigns()` через `listAll()` |
| Лендінги (`/landing_pages`) | один запит повертає повний список, `offset` ігнорується | `listAllLandings()` — один запит |
| Офери (`/offers`) | один запит повертає повний список, `offset` ігнорується | `listAllOffers()` — один запит |

Списки лендінгів та оферів кешуються у `KeitaroGuiService` до закриття
програми. Вибір групи фільтрує вже кешований список, тому не завантажує каталог
повторно.

Кілька змін одним HTTP-запитом: `sendBatch(operations)` надсилає
`POST /admin_api/v1/?batch`. Тіло — масив `{ method, path, params }`.

## Доступні методи

### Кампанії

| Метод | HTTP |
| --- | --- |
| `listCampaigns(params)` | `GET /campaigns` |
| `listAllCampaigns(params)` | той самий список з пагінацією |
| `getCampaign(id)` | `GET /campaigns/{id}` |
| `createCampaign(data)` | `POST /campaigns` |
| `updateCampaign(id, data)` | `PUT /campaigns/{id}` |
| `deleteCampaign(id)` | `DELETE /campaigns/{id}` |
| `cloneCampaign(id, data)` | `POST /campaigns/{id}/clone` |
| `restoreCampaign(id)` | `POST /campaigns/{id}/restore` |
| `getCampaignStreams(id)` | `GET /campaigns/{id}/streams` |
| `applyStreamTemplateToCampaigns(options)` | паралельно створює або замінює потік у вибраних кампаніях |
| `updateCampaignCosts(id, data)` | `POST /campaigns/{id}/update_costs` |
| `enableCampaign(id)` | `PUT /campaigns/{id}` зі `state: "active"` |
| `disableCampaign(id)` | `PUT /campaigns/{id}` зі `state: "disabled"` |
| `moveCampaignsToGroup(campaignIds, groupId)` | Масово оновлює `group_id` вибраних кампаній |

Підсистема спенду використовує `updateCampaignCosts()` тільки через клас
`Keitaro`. Відповідність із Meta визначається звітом із вимірами `campaign_id`
та `sub_id_2`. Детальний формат зберігання й повторів описаний у
[`docs/spend.md`](spend.md).

### Групи кампаній

У цьому Admin API окремого `/campaign_groups` немає. Групи кампаній читаються
як `GET /groups?type=campaigns`.

`listCampaignGroups`, `listAllCampaignGroups`, `getCampaignGroup`,
`createCampaignGroup`, `updateCampaignGroup`, `deleteCampaignGroup`.

### Офери, лендінги, потоки

CRUD: `list/get/create/update/delete` для `Offer`, `Landing`, `Stream`.
Для масового перенесення оферів між групами є `moveOffersToGroup(offerIds, groupId)`.
Для повного списку є `listAllOffers` і `listAllLandings`.
У цьому Keitaro офери й лендінги повертаються одним повним списком, тому їхні
методи не запускають offset-пагінацію та не дублюють один і той самий запит.
У поточному Keitaro загальний маршрут `GET /streams` недоступний. Для пошуку
потоків використовується `searchStreams({ query })` (`GET /streams/search`), де
`query` є обов'язковим параметром.
Доступність country-фільтра редактор перевіряє через офіційний метод
`listStreamFilters()` (`GET /stream_filters`). Після цього показує локальний
ISO-довідник назв країн; у payload потоку передаються дволітерні коди, які
використовує Keitaro.

### Джерела, партнерки, домени, групи, користувачі

CRUD для `TrafficSource`, `AffiliateNetwork`, `Domain`, `Group`, `User`.
`Group` тут — групи оферів/лендінгів Keitaro, не групи кампаній.

### Кліки та конверсії

| Метод | HTTP |
| --- | --- |
| `getClick(id)` | `GET /clicks/{id}` |
| `logClicks(data)` | `POST /clicks/log` |
| `updateClicks(data)` | `POST /clicks/update` |
| `listConversions(params)` | `GET /conversions` |
| `getConversion(id)` | `GET /conversions/{id}` |
| `createConversion(data)` | `POST /conversions` |
| `updateConversion(id, data)` | `PUT /conversions/{id}` |

### Звіт

`buildReport(payload)` надсилає `POST /report/build`. Для вкладки GUI потрібні
кампанії з метриками кліків, конверсій і доходу.

GUI також будує звіт оферів із виміром `offer_id`. Період звіту може бути
готовим пресетом або власним діапазоном `dateRange: { from, to }`.

## GUI

`KeitaroGuiService` збирає групи кампаній і звіт для вкладки Keitaro. Renderer
не отримує API-ключ. Доступні групи зберігаються в `data/app-state.json` як
`keitaroAvailableGroupIds`.

Підвкладка «Кампанії» показує повноекранну таблицю, підтримує зміну порядку й
ширини колонок, копіювання базової URL кампанії без query-параметрів, підсумок
поточної сторінки або вибраних рядків та масове перенесення до іншої групи.

Підвкладка «Офери» використовує `getOffersReport()` у `KeitaroGuiService`,
пошук і фільтр групи. Режим групування об'єднує офери лише за одночасного збігу
групи, GEO на початку назви, тексту в квадратних дужках і партнерської мережі.
Лічильники групи сумуються, а `CR`, `ROI`, `EPC` і `CPC` перераховуються із
загальних значень.

Згрупований офер показується як один батьківський рядок з агрегованими
показниками. Після розгортання під ним відображаються компактні дочірні рядки
кожного офера з його власними показниками. Стан перемикача групування
зберігається в `data/app-state.json` як `keitaroOffersGrouped`. Для кампаній і
оферів доступний розмір сторінки до 500 елементів.

Шаблони потоків зберігаються локально. Для них зафіксовано безпечний контракт:
звичайний увімкнений потік із рахуванням кліків, схемою `landings`, вибором оферу
`before_click` та без фільтрів. Користувач задає лише назви, лендінги й офери;
невідомі поля потоку не зберігаються. Поля `id`, `campaign_id` і `position`
вилучаються, бо для кожної цільової кампанії вони свої. Масове застосування
шукає потоки через `GET /streams/search` за назвою шаблону, залишає лише точні
збіги назви та оновлює знайдені потоки послідовно через клас `Keitaro`.

## Помилки

- `KEITARO_CONFIG_ERROR` — порожній або некоректний URL/ключ;
- `KEITARO_VALIDATION_ERROR` — немає ID або тіла звіту;
- `KEITARO_API_ERROR` — відповідь трекера або мережева помилка.

## Перевірка

```powershell
node test/testKeitaroClientMock.js
node test/testKeitaroGuiServiceMock.js
```
