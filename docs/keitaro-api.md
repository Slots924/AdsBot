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

Публічні методи не викликають Axios напряму. Черга запитів централізована в
`request()`. Помилка одного запиту не блокує наступні.

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

## Помилки

- `KEITARO_CONFIG_ERROR` — порожній або некоректний URL/ключ;
- `KEITARO_VALIDATION_ERROR` — немає ID або тіла звіту;
- `KEITARO_API_ERROR` — відповідь трекера або мережева помилка.

## Перевірка

```powershell
node test/testKeitaroClientMock.js
node test/testKeitaroGuiServiceMock.js
```
