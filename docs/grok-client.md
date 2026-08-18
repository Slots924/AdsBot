# Grok client

Модуль `services/llm/grok` виконує прямі текстові запити до xAI Responses API.
Він не використовує Facebook-проксі, cookies, User-Agent або AdsPower.

## Налаштування

Додайте до локального `.env`:

```env
XAI_API_KEY=REPLACE_WITH_XAI_API_KEY
XAI_API_URL=https://api.x.ai/v1/responses
XAI_MODEL=grok-4.5-latest
```

`XAI_API_KEY` є секретом: його не можна додавати в Git, документацію, тести або
логи. Alias моделі зберігається в `.env`, тому його можна замінити без зміни
класу. `grok-4.5-latest` підтримує reasoning; стандартний рівень reasoning для
цієї моделі — `high`.

## Використання

```js
import "dotenv/config";

import GrokClient from "./services/llm/grok/GrokClient.js";
import loadGrokSystemPrompt
    from "./services/llm/grok/loadGrokSystemPrompt.js";

const systemPrompt = await loadGrokSystemPrompt();
const grokClient = new GrokClient();

const result = await grokClient.generateText({
    systemPrompt,
    prompt: "Поясни різницю між HTTP та HTTPS",
});

console.log(result.text);
```

`generateText()` надсилає два повідомлення: `system` і `user`. Успішний
результат має форму:

```js
{
    text: "Відповідь Grok",
    responseId: "response-id",
    model: "grok-4.5-...",
    usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
    },
}
```

Автоматичного retry немає: один виклик `generateText()` створює не більше одного
оплачуваного API-запиту.

## System prompt

Стандартний system prompt зберігається в `data/prompts/grok/system.txt` як
звичайний UTF-8 текст. Його можна редагувати без змін у `GrokClient`.

Інший файл можна завантажити явно:

```js
const systemPrompt = await loadGrokSystemPrompt(
    "./data/prompts/grok/another-system.txt"
);
```

## Помилки

- `GROK_CONFIG_ERROR` — відсутня або некоректна конфігурація чи system prompt;
- `GROK_VALIDATION_ERROR` — порожній system або user prompt;
- `GROK_API_ERROR` — HTTP/API-помилка xAI;
- `GROK_EMPTY_RESPONSE` — API не повернув жодного `output_text`.

Помилки не містять API key або повну Axios-конфігурацію.

## Перевірка

Безпечний mock-тест без реального xAI-запиту:

```powershell
node test/testGrokClientMock.js
```

Для ручної перевірки заповніть багаторядкову змінну `prompt` на початку
`test/testGrokClient.js`, а потім запустіть:

```powershell
node test/testGrokClient.js
```

Ручний сценарій виконує реальний оплачуваний запит.
