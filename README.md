# AdsBot

AdsBot — Node.js-проєкт для роботи з AdsPower, автоматизації Facebook у
браузері, читання даних Facebook Graph API та публікації постів на фанпейджі.

## Основні підсистеми

- `classes/AdsPower.js` — централізована робота з AdsPower Local API.
- `facebook/actions`, `facebook/state`, `facebook/workflows` — браузерна автоматизація Facebook.
- `facebook/api` — запити до Facebook Graph API для кількох акаунтів.
- `services/proxy` — перевірка проксі та HTTP-клієнт з автоматичним failover.
- `services/llm/grok` — прямі текстові запити до xAI Grok.
- `services/creatives` — пошук і автоматична адаптація креативів під країну.
- `scenarios` — сценарії, які поєднують окремі workflow.

Докладніше:

- [Facebook Graph API](docs/facebook-api.md)
- [Proxy client](docs/proxy-client.md)
- [Grok client](docs/grok-client.md)
- [Creative manager](docs/creative-manager.md)

## Налаштування

1. Встановити залежності командою `npm install`.
2. Створити `.env` і додати потрібні змінні оточення.
3. Для Facebook API скопіювати example-конфіги:
   - `data/facebookApi/accounts.example.json` → `data/facebookApi/accounts.json`;
   - `data/facebookApi/proxies.example.json` → `data/facebookApi/proxies.json`.
4. Заповнити локальні конфіги реальними значеннями.

Facebook Graph API використовує захардкоджену версію `v26.0`.

`npm start` запускає поточний сценарій з `index.js`. Перед запуском потрібно перевірити його налаштування, оскільки сценарій може працювати з реальними профілями AdsPower.

## Секретні дані

Не додавати до Git `.env`, access tokens, Facebook session cookies, Page access tokens, логіни й паролі проксі або дані профілів. Реальні `accounts.json` і `proxies.json` ігноруються Git. У документації, тестах і логах дозволені лише явно несправжні placeholders.
