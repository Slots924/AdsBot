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

### Групи кампаній

У цьому Admin API окремого `/campaign_groups` немає. Групи кампаній читаються
як `GET /groups?type=campaigns`.

`listCampaignGroups`, `listAllCampaignGroups`, `getCampaignGroup`,
`createCampaignGroup`, `updateCampaignGroup`, `deleteCampaignGroup`.

### Офери, лендінги, потоки

CRUD: `list/get/create/update/delete` для `Offer`, `Landing`, `Stream`.
Для повного списку є `listAllOffers`, `listAllLandings`, `listAllStreams`.
У цьому Keitaro офери й лендінги повертаються одним повним списком, тому їхні
методи не запускають offset-пагінацію та не дублюють один і той самий запит.
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

## GUI

`KeitaroGuiService` збирає групи кампаній і звіт для вкладки Keitaro. Renderer
не отримує API-ключ. Доступні групи зберігаються в `data/app-state.json` як
`keitaroAvailableGroupIds`.

Шаблони потоків зберігаються локально. Для них зафіксовано безпечний контракт:
звичайний увімкнений потік із рахуванням кліків, схемою `landings`, вибором оферу
`before_click` та без фільтрів. Користувач задає лише назви, лендінги й офери;
невідомі поля потоку не зберігаються. Поля `id`, `campaign_id` і `position`
вилучаються, бо для кожної цільової кампанії вони свої. Застосування виконується паралельно через клас `Keitaro`, а
ліміт одночасних HTTP-запитів і далі контролює його внутрішній `request()`.

## Помилки

- `KEITARO_CONFIG_ERROR` — порожній або некоректний URL/ключ;
- `KEITARO_VALIDATION_ERROR` — немає ID або тіла звіту;
- `KEITARO_API_ERROR` — відповідь трекера або мережева помилка.

## Перевірка

```powershell
node test/testKeitaroClientMock.js
node test/testKeitaroGuiServiceMock.js
```
