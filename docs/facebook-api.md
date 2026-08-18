# Facebook Graph API

Підсистема `facebook/api` виконує read-only запити до Graph API. Вона не залежить від AdsPower і не запускає браузер. Кожен Facebook-акаунт має власні access token, session cookies та User-Agent, але всі клієнти використовують один спільний `ProxyHttpClient`.

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

const clients = await createFacebookApiClients();
const facebookApi = clients.get("account-001");

if (!facebookApi) {
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
| `getAdAccounts()` | `Array` | Повертає всі доступні рекламні акаунти. |
| `getPages()` | `Array` | Повертає всі fan pages, tasks і `pageAccessToken`. |

Приклад:

```js
const tokenStatus = await facebookApi.checkAccessToken();

if (!tokenStatus.working) {
    console.error("Access token не працює");
    return;
}

const me = await facebookApi.getMe();
const permissions = await facebookApi.getPermissions();
const adAccounts = await facebookApi.getAdAccounts();
const pages = await facebookApi.getPages();
```

`getAdAccounts()` і `getPages()` автоматично проходять усі сторінки Graph API через cursor `after`. Код не використовує абсолютний `paging.next`, щоб access token випадково не потрапив до логів разом із URL.

## Заголовки

Кожен запит містить лише прикладні заголовки:

- `Authorization: Bearer ...`;
- `Cookie` із конфігурації акаунта;
- `User-Agent` із конфігурації акаунта;
- `Accept: application/json`.

Клієнт не додає `sec-fetch-*`, `sec-ch-ua`, `Origin`, `Referer` або `X-Requested-With`. Системні `Host`, `Connection` та `Accept-Encoding`, які додає HTTP-стек Node.js, є нормальними транспортними заголовками.

## Помилки й токени

- Graph API errors перетворюються на Error з `code="FACEBOOK_API_ERROR"` та полями `httpStatus`, `graphCode`, `graphSubcode`, `graphType`.
- Вичерпання проксі повертає `code="PROXY_POOL_EXHAUSTED"`.
- HTTP-помилки Meta не запускають proxy failover, окрім HTTP 407 від проксі.
- Access tokens, session cookies і Page access tokens не можна виводити в логи.

Токени, отримані з DOM Ads Manager, працюють разом з активними session cookies того самого Facebook-акаунта. Якщо cookies протухли або сесію завершено, їх потрібно оновити в локальному `accounts.json`. Повний `debug_token` вимагає credentials Meta App, який видав token, тому в першій версії не підтримується.

## Ручна перевірка

Після заповнення `.env`, `accounts.json` і `proxies.json` вкажіть потрібний `accountKey` у `test/testFacebookGraphApi.js` та запустіть:

```powershell
node test/testFacebookGraphApi.js
```

Окремий read-only сценарій для пошуку вимкнених рекламних акаунтів профілю
`fp_hub`:

```powershell
node test/testDisabledAdAccounts.js
```

Сценарій відбирає акаунти з `accountStatus === 2` і показує `disableReason`,
Business, власника та основні фінансові поля.
`disableReason` є технічною категорією Meta й не завжди містить детальний текст
конкретного порушення.

Сценарій не змінює дані Facebook і не виводить access tokens або session cookies. Він виконує реальні запити, тому автоматично не запускається.
