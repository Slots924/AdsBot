# AdsBot Desktop GUI

GUI працює як локальна Electron-програма. React renderer знаходиться повністю в
`frontend/`, а Facebook, AdsPower, Grok і файли залишаються у Node backend.
Renderer не отримує access tokens, cookies, proxy credentials або довільний
доступ до файлової системи.

## Запуск

Один раз встановіть frontend-залежності:

```powershell
cd frontend
npm install
cd ..
```

Потім запускайте програму з кореня проєкту:

```powershell
npm run gui:dev
```

Production-збірка renderer без Windows installer:

```powershell
npm run gui:build
```

Перед запуском мають бути заповнені кореневий `.env`, локальні
`data/facebookApi/accounts.json` і `data/facebookApi/proxies.json`. AdsPower
Local API має бути доступний для оновлення груп і запуску коментарів.

## Вибір Facebook-акаунта

Ліва панель викликає `AdsBotGuiService.getAccounts()` і показує:

- зелений статус — `/me` успішний;
- червоний — Meta підтвердила invalid token;
- жовтий — proxy, network або інша API-помилка.

Ключ вибраного акаунта зберігається лише в React state. Кожний запит фанпейджів,
публікації або рекламних акаунтів явно отримує `accountKey`. Неактивний профіль
можна переглянути в sidebar, але його Graph API-дії заблоковані.

## Публікація

Вкладка отримує безпечний список фанпейджів, готує креатив через
`CreativeManager`, підставляє обов'язковий offer URL і викликає наявний workflow
публікації. Картинка необов'язкова; підтримуються JPG, JPEG, PNG і WEBP.

Після успіху GUI показує post ID і Facebook permalink. Geo, назва креативу,
offer URL і permalink автоматично переносяться у форму коментарів. Також GUI
шукає першу групу, назва якої містить точний geo-маркер на кшталт `[HU]`, і
додає її до вибору без видалення вже вибраних груп.

## Коментарі та групи AdsPower

Коментарі пишуть профілі вибраних груп AdsPower, а не вибраний Graph
API-акаунт. Offer URL тут необов'язковий: порожнє значення замінює точні
`<LINK>` у коментарях порожнім рядком.

Кнопка оновлення груп використовує лише Profile API V2. `AdsPower.getProfiles()`
отримує профілі сторінками по 100, після чого `AdsPowerGroupService` збирає
унікальні групи й атомарно оновлює `data/adspower-groups.json`.

Одночасно може виконуватися лише одна кампанія. Поки вона активна, повторний
запуск і закриття головного вікна блокуються. Після завершення GUI показує
підсумок та шлях до Markdown-звіту.

## IPC і безпека

Electron працює з `contextIsolation: true`, `nodeIntegration: false` та sandbox.
Preload відкриває тільки конкретні методи `window.adsBot`. Generic IPC не
експонується. Backend-помилки серіалізуються без stack і конфігів запиту.
Зовнішньо дозволено відкривати лише HTTPS-посилання домену Facebook.

## Перевірка

```powershell
node test/testAdsBotGuiServiceMock.js
node test/testGuiIpcMock.js
npm run gui:test
npm run gui:build
```

Mock-тести не створюють реальних Facebook-постів, не запускають браузерні
профілі AdsPower і не виконують платних Grok-запитів.
