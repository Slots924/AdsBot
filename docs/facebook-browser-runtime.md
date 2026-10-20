# Facebook browser API: runtime замість перехоплених запитів

API-екшини приймають Puppeteer `page` і параметри бізнес-операції. Workflow не передає `commonPayload`, CSRF-параметри чи access token. Підтримки старого контракту та fallback на перехоплення немає.

```js
await changeProfilePicture({ page, imagePath });
await updateBusinessInfo({ page, billableAccountPaymentLegacyAccountId, currency, timezone, tax });
await getAdPixels({ page, adAccountId });
```

## Зміна назви фанпейджа

`facebook/api-actions/pages/changeFanPageName.js` експортує `changeFanPageName`
за замовчуванням і `changeFanPageNameStatuses`. Контракт:

```js
const result = await changeFanPageName({
    page,
    name: "New Page Name",
    password,
    additionalProfileId,
    timeout: 45000,
});
```

Перед викликом потрібна вкладка `https://www.facebook.com` у профілі потрібної
Page. Екшин не переходить до налаштувань і не перемикає профілі.
Необов'язковий `additionalProfileId` звіряється з поточним `av`; це actor ID,
а не обов'язково `page.id`. Без цього параметра використовується активний контекст.
Пароль передається аргументом лише для цієї операції; вікно введення належить
виклику/GUI, а не API action.

Legacy AJAX flow: GET `/ajax/settings/account/name.php` → POST
`/settings/name_change_preview/` → одноразовий POST початкового endpoint.
Приховані поля беруться з актуальних форм. Перед фінальним POST перевіряються
назва в preview та наявність поля `save_password`; POST використовує спільний
transport з перевіркою незмінності actor.

Результат має `{ success, status, data, stage, httpStatus?, message, error? }`.
`REQUEST_SUBMITTED` означає `success: true`: немає явної помилки, є
`payload === true` та команда `SettingsController.closeAndAnimateEdited`.
Це прийняття заявки; остаточне схвалення назви окремо не перевіряється.
`showError` завжди має пріоритет: його динамічні markup-посилання розв'язуються
до очищеного тексту в `message`/`error`. Відоме повідомлення про недопустиме
ім'я дає `NAME_NOT_ALLOWED`, інші — `FACEBOOK_VALIDATION_ERROR`.
Для невідомого формату/результату успіх не повертається. Загальний текст
про 60 днів у формах не використовується для висновку про cooldown.

Пароль, CSRF та сирі відповіді не логуються і не включаються до результату;
відомі секрети маскуються в тексті помилки. Немає повторних POST, зокрема
після таймауту: на етапі `SUBMIT` він означає невідомий результат заявки.
Текстова класифікація використовує спільний словник дев'яти мов; лише
англійський варіант підтверджено наданим прикладом відповіді Facebook.
Інші помилки будь-якою мовою все одно повертаються через `showError`.

`node test/testChangeFanPageNameAction.js` перевіряє flow у mock-сесії та
виконує справжній DOM-розбір через наявний frontend `jsdom` (потрібні встановлені
frontend devDependencies). Тест не виконує запитів до Facebook.

## Спільні модулі

- `facebook/api/runtime.js`: перевірка HTTPS і точного hostname, навігація лише за потреби, очікування runtime, читання актуальних `getAsyncParams`, DTSG, LSD, CurrentUserInitialData та SiteData. `jazoest` обчислюється з актуального DTSG. Параметри не кешуються між екшинами.
- `facebook/api/browserRequest.js`: формування form body, перевірка runtime, освіження токенів перед відправленням, перевірка незмінності `av` та `__user`, HTTP-запит усередині вкладки й парсинг відповіді. Немає автоматичного повтору mutation після помилки чи таймауту.
- `facebook/api/browserCredentials.js`: читання access token зі сторінки Ads Manager, cookies і user agent для створення або синхронізації API-клієнта. Graph API екшини самі читають актуальний токен. Cookies для browser-запитів підставляє браузер.

Службові поля, доступні через `getAsyncParams`, читаються без мережевого перехоплення. Екшин формує необхідний йому набір полів; читання runtime не змінює `doc_id`, variables та доменні правила операції. Відсутній обов'язковий runtime зупиняє дію. Сирі службові параметри не передаються до GUI чи звітів.

## Персональні сесії та GUI

Запуск: перевірки AdsPower → відкриття Facebook та перевірка акаунта → визначення основного профілю → підготовка Ads Manager → читання токена → завантаження огляду.

Сесія зберігає браузер, вкладку, actor, основний профіль, дані огляду, телефонного flow й token для відображення готовності. Вона не зберігає Facebook/Ads Manager/BM payload чи URL їх отримання. Перед створенням API-клієнта credentials читаються повторно. У GUI відсутні індикатори та перевірки завантаження payload.

Дії однієї сесії залишаються послідовними через наявну чергу. Списки, які читаються паралельно в огляді, використовують уже підготовлену вкладку Ads Manager.

## Збережені винятки та межі змін

- **Фанпейджі:** збережено відмінність Graph `pageId` та `additionalProfileId`, перемикання на потрібного actor, `bringToFront` і примусовий перехід на `/me` для підтвердження перемикання. Підтвердження тепер читає runtime, а не перехоплений payload. Reauth та invite відхиляються, якщо поточний actor не відповідає `additionalProfileId`.
- **Billing:** перехід на `/adsmanager/billing_hub/payment_settings/` також допускає редирект на `/adsmanager/billing_hub/accounts/details/`. Обидва шляхи дозволені лише на HTTPS-домені `adsmanager.facebook.com` зі збігом `asset_id` та `payment_account_id` потрібного акаунта. Додаткові query-параметри не впливають на перевірку. `ensureFacebookPage` приймає `allowedPaths` разом із `matchPath: true` та застосовує однакові правила до поточної адреси й адреси після переходу (`page.url()`). Помилка вказує причину: протокол, домен, шлях або назву невідповідного query-параметра, без його значення. Збережено завантаження Billing/Relay-модулів, PTT, шифрування та risk flow.
- **Доступ до РК:** для списку запрошень збережено спеціальний екран налаштувань та його `act`. `ext`/`hash` конкретного запрошення й асинхронний `DTSG_ASYNC` для GET залишаються необхідними.
- **Accounts Center:** зміна імені готує окремий домен. Збережено перевірку правил імені, валідацію та mutation.
- **About і пости:** збережено отримання актуальних токенів About-секцій, контексту приховування конкретного поста, пагінацію та порядок операцій. Це дані конкретної дії, які не замінюються спільним runtime.
- **Graph API:** клас `FacebookGraphApi`, proxy transport, версії API, `doc_id`, friendly names та доменні variables не переписувалися через цю міграцію.

Видалено capture action, інструменти збереження/порівняння payload і npm-команду `manual:compare-payloads`. Ручні сценарії дій переведені на новий контракт, але не запускалися на реальних акаунтах.

## Перевірки та подальші живі тести

`node test/testFacebookRuntime.js` виконує справжні browser callbacks у відокремленому JS-контексті з mock-модулями та HTTP. Перевіряє навігацію, актуальність токенів, runtime errors, actor mismatch, credentials, асинхронний GET і відсутність автоматичного повтору mutation. Тест включено до `npm run test:all`.

Mock-тести не підтверджують актуальність внутрішніх модулів чи схем на серверах Meta. Окремо перевірити на тестовому профілі:

1. Запуск персонального й БМ-профілю та створення API-клієнта.
2. Ім'я, аватар, обкладинку, Bio, освіту й роботу після переходів між доменами.
3. Публікацію, датування, видалення й приховування постів.
4. Створення фанпейджа, перемикання туди й назад, reauth та видачу доступу.
5. Запит/прийняття/відхилення доступу до РК і перемикання між різними РК.
6. Business info, телефонний flow, Billing/Relay-модулі та додавання карти.

Живі дії проти Facebook, AdsPower або Keitaro під час локальної перевірки цієї міграції не виконуються.
