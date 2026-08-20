# Creative manager

`CreativeManager` повертає готові локалізовані креативи та за потреби створює
їх через Grok. Готовий результат є JS-об'єктом із полями `creative` і
`comments`.

## Структура даних

```text
data/
├── countries.json
├── creatives/
│   ├── originals/
│   │   └── 138.txt
│   └── US 138.json
└── prompts/
    └── grok/
        └── format-creative-to-json.txt
```

`countries.json` містить ISO 3166-1 alpha-2 коди та англійські назви країн.
Geo можна передавати в будь-якому регістрі: `us` буде нормалізовано до `US`.

Назва креативу може містити від 1 до 100 латинських літер, цифр, `_` або `-`.
Наприклад, назві `new_offer` відповідають файли:

- `data/creatives/originals/new_offer.txt`;
- `data/creatives/US new_offer.json`.

## Отримання креативу

```js
import "dotenv/config";

import CreativeManager
    from "./services/creatives/CreativeManager.js";

const creativeManager = new CreativeManager();
const creative = await creativeManager.getCreative("US", "138");

console.log(creative.creative);
console.log(creative.comments);
```

## Підготовка для кампанії

Збережений креатив є шаблоном і не змінюється. Чиста функція
`prepareCreativeForCampaign()` створює копію та замінює всі точні маркери
`<LINK>` у головному тексті й `comments[].text`:

```js
import prepareCreativeForCampaign
    from "../services/creatives/prepareCreativeForCampaign.js";

const preparedCreative = prepareCreativeForCampaign({
    creative,
    siteUrl: "https://example.com/offer",
});
```

Для backend/GUI цю операцію вже обгортає
`facebookBackend.prepareCreative({ geo, creativeName, siteUrl })`. Дозволені
тільки HTTP/HTTPS URL. Якщо `<LINK>` немає ні в тексті, ні в коментарях,
повертається `CREATIVE_LINK_PLACEHOLDER_NOT_FOUND`.

Для запуску сценарію коментування передайте в нього лише масив коментарів із
готового креативу. Geo та назва передаються окремо як metadata для звіту:

```js
const creative = await creativeManager.getCreative(
    geo,
    creativeName
);

await runCommentingScenario({
    adsPower,
    groupIds,
    comments: creative.comments,
    geo,
    creativeName,
    postUrl,
    browserMode: "headless",
    disableImages: true,
});
```

`runCommentingScenario()` не читає файл креативу та не викликає Grok.
`browserMode` приймає `visible` або `headless`, а `disableImages` керує лише
AdsPower launch argument для блокування зображень. Обидва поля зберігаються у
звіті фактичного запуску.

Додатковий backend-сценарій `runParallelCommentingScenario()` поки не
підключений до GUI. Він використовує динамічний пул від 1 до 5 worker'ів:
кореневі коментарі доступні відразу, а reply додається в ready-чергу одразу
після успішної публікації свого `parent_id`. Загального бар'єра між рівнями
дерева немає. Mutex за `profile_key` і `profile_no` не дозволяє паралельно
відкрити той самий AdsPower-профіль. Сценарій приймає `AbortSignal`, закриває
активні профілі та передає структурований прогрес із `completed`, `total`,
лічильниками результатів і кількістю активних worker'ів.

У Desktop GUI для коментарів використовується
`prepareCommentsForCampaign({ creative, siteUrl })`. На відміну від підготовки
Facebook-поста, `siteUrl` тут необов'язковий: порожнє значення замінює точні
`<LINK>` порожнім рядком, а відсутність placeholder не є помилкою.

`getCreative()` спочатку читає готовий JSON. Якщо файла немає, менеджер:

1. перевіряє geo через `countries.json`;
2. читає оригінальний `.txt` і system prompt;
3. викликає `GrokClient.generateJson()` зі строгою JSON-схемою;
4. перевіряє результат, зберігає його і повертає JS-об'єкт.

Паралельні запити для одного geo та name використовують одну операцію
генерації. Наявний пошкоджений JSON не перезаписується автоматично.

## Примусова перегенерація

```js
const creative = await creativeManager.createCreative("US", "138");
```

`createCreative()` завжди викликає платний Grok API та після успішної
перевірки перезаписує готовий файл. Якщо читання оригіналу, виклик Grok або
перевірка відповіді завершилися помилкою, наявний готовий файл не змінюється.
Перед початком генерації менеджер виводить у консоль geo та назву креативу і
попереджає, що операція може зайняти декілька хвилин.

## Формат результату

```js
{
    creative: "Текст креативу",
    comments: [{
        id: "1",
        parent_id: null,
        text: "Текст коментаря",
        gender: "male",
        profile_key: null,
        is_author: false,
        should_write: true,
    }],
}
```

Зайві поля, неправильні типи та значення gender поза `male`, `female` або
`null` відхиляються.

## Помилки

- `CREATIVE_VALIDATION_ERROR` — неправильний geo, name або Grok-клієнт;
- `CREATIVE_COUNTRY_NOT_FOUND` — коду країни немає у списку;
- `CREATIVE_ORIGINAL_NOT_FOUND` — оригінал відсутній або порожній;
- `CREATIVE_INVALID_FILE` — готовий JSON пошкоджений;
- `CREATIVE_INVALID_RESPONSE` — результат Grok не відповідає схемі;
- `CREATIVE_FILE_ERROR` — не вдалося прочитати або зберегти файл;
- `GROK_*` — помилка конфігурації чи запиту до xAI.

## Перевірка

Безпечний тест не виконує реальних запитів до xAI та працює лише в тимчасовій
папці:

```powershell
node test/testCreativeManagerMock.js
```

Для ручної перевірки вкажіть `geo` та `creativeName` на початку
`test/testCreativeManager.js`, після чого запустіть:

```powershell
node test/testCreativeManager.js
```

Якщо готового JSON немає, цей сценарій виконає реальний платний запит до Grok.
