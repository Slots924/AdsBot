# SMSPool API

Усі запити до SMSPool проходять лише через клас `SmsPool` у
`classes/SmsPool.js`. Не викликайте SMSPool API безпосередньо з `index.js`,
сервісів, IPC або React-компонентів.

## Налаштування

Додайте токен до локального `.env`:

```env
SMS_POOL_API_TOKEN=REPLACE_WITH_SMSPOOL_API_TOKEN
```

За потреби для тестового середовища можна вказати `SMS_POOL_API_URL`; типовою
адресою є `https://api.smspool.net`. Токен є секретом: його не можна додавати
до Git, документації, тестових даних, UI або логів.

## Каталог і ціни

Країни, сервіси, пули та ціни не зберігаються статично в репозиторії. Їх слід
отримувати перед відображенням у UI та, за потреби, кешувати в сервісі:

```js
import "dotenv/config";

import SmsPool from "./classes/SmsPool.js";

const smsPool = new SmsPool();
const [countries, services, pools, pricing] = await Promise.all([
    smsPool.listCountries(),
    smsPool.listServices(),
    smsPool.listPools(),
    smsPool.getPricing(),
]);

const facebookUsPrice = await smsPool.getPrice({
    country: "US",
    service: "Facebook",
});
```

Конкретні ідентифікатори країни й сервісу беруться з відповідей `listCountries()`
і `listServices()`. Перед замовленням слід отримувати `getPrice()`, щоб UI міг
показати актуальну ціну та успішність, а користувач міг обмежити `maxPrice`.

## Одноразовий SMS-номер

```js
const order = await smsPool.purchaseSms({
    country: "US",
    service: "Facebook",
    maxPrice: 0.5,
    pricingOption: 1,
});

const status = await smsPool.checkSms(order.order_id);
```

`purchaseSms()` повертає номер і `order_id`. Його треба зберегти разом з
операцією підтвердження. Для отримання SMS використовується polling:
`checkSms(orderId)` раз на 3–5 секунд до `time_left`, а для кількох замовлень —
`getActiveSmsOrders()`.

| Статус | Значення |
| --- | --- |
| `1` | Очікування SMS |
| `3` | SMS отримано, код у `sms`, повний текст у `full_sms` |
| `6` | Повернення коштів |

Інші відомі значення експортовані у `smsPoolOrderStatuses`: `EXPIRED`,
`CANCELLED`, `RESEND`, `PROCESSING`, `ACTIVATING`.

Для ручного повернення викликайте `cancelSms(orderId)`. На початку оренди
SMSPool може тимчасово не дозволити скасування; в такому разі повторіть дію
пізніше. Якщо код не надійшов до завершення оренди, SMSPool повідомляє про
автоматичне повернення статусом `6`.

## Методи класу

| Метод | Призначення |
| --- | --- |
| `listCountries()` | Доступні країни |
| `listServices()` | Доступні сервіси |
| `listPools()` | Доступні пули номерів |
| `getBalance()` | Баланс акаунта |
| `getPricing()` | Повний прайс-лист |
| `getPrice({ country, service })` | Ціна й успішність вибраної пари |
| `purchaseSms(options)` | Замовити номер |
| `checkSms(orderId)` | Отримати стан і SMS одного замовлення |
| `getActiveSmsOrders()` | Отримати всі активні замовлення |
| `getSmsOrderHistory(params)` | Отримати історію |
| `archiveSmsOrders()` | Архівувати неактивні замовлення |
| `getSmsStock({ country, service, pool })` | Дізнатися кількість доступних номерів |
| `cancelSms(orderId)` | Скасувати замовлення і запитати повернення |
| `cancelAllSms()` | Скасувати всі активні замовлення |
| `clearSmsCache()` | Очистити кеш використаних номерів |
| `checkSmsResend(orderId)` | Перевірити доступність і ціну повторного SMS |
| `resendSms(orderId)` | Запросити повторне SMS |
| `activateSms(orderId)` | Активувати номер для повторних SMS без повернення коштів |
| `reactivateSms(orderId)` | Повторно активувати номер пулу Foxtrot без повернення коштів |

Усі публічні методи використовують внутрішній `request()`. Помилки класу мають
коди `SMS_POOL_CONFIG_ERROR`, `SMS_POOL_VALIDATION_ERROR` або
`SMS_POOL_API_ERROR`; остання містить лише безпечний статус `httpStatus` і
ніколи не містить токен.

## Офіційні джерела

- [SMSPool: замовлення, перевірка та скасування номера](https://www.smspool.net/article/smspool-api-order-view-and-cancel-numbers-9883b6969fad)
- [Офіційна колекція SMSPool у Postman](https://www.postman.com/smspool/smspool-api/collection/be7o1wo/smspool-api)
