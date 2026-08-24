# План: ввід About на особистій сторінці Facebook

## Мета

Один новий профільний action: з англомовної домашньої сторінки (`/me`) відкрити About і ввести **біо**, **роботу**, **освіту (College)**. Не кидати помилку назовні. Повертати звіт: що вдалося, що пропущено, що ні.

Референс поведінки: `publishFacebookPersonalProfileMediaPostsWithDates.js` + `changeFacebookName.js`.  
Референс DOM: `facebook/actions/additioanalSelector list.txt` (не імпортувати).

## Рішення

- Вхід вкладений. Зайві ключі ігнорувати. Порожній / пробільний рядок = ключа немає.
- `bio` **завжди** обробляємо: є текст → писати/редагувати; ключа немає → стерти наявне. Вже порожнє біо при відсутності ключа = успіх `CLEARED`.
- `work` лише якщо є і `company`, і `position`. Інакше `SKIPPED`. Є будь-який `Edit Workplace` → `SKIPPED`, другий запис не додаємо.
- `education` — рядок назви коледжу. Немає / кривий тип → `SKIPPED`. Є `Edit college` → `SKIPPED`. High school поза скоупом.
- `{}` валідний: тільки спроба стерти біо.
- Кнопка порожньої роботи: як College — у секції `h2=Work` кнопка з текстом `Work`.
- Успіх поля **не** визначати лише по `Leave Page?`. Головне: форма зникла + текст у секції + кнопка Edit. `Leave Page?` і `Invalid Name` — cleanup і сигнал провалу.
- Селектори в `facebook/selectors/personalProfileAbout.js` (`i` на aria-label). Це той самий виняток, що в інших нових actions. Логіка лишається в `facebook/actions/`.
- Один файл-оркестратор, внутрішні хелпери (не окремі public actions).
- Не ретраїти поле після провалу. Закрити діалоги й іти далі.

## Контракт

```js
await fillFacebookPersonalProfileAbout(page, {
    fields: {
        bio: "I hike on weekends",
        work: { company: "Acme", position: "Engineer" },
        education: "Harvard University",
    },
    timeout: 90000,
    random, sleep, logger, onProgress,
});
```

Повертає:

```js
{
    success,                    // true лише якщо жоден REQUESTED крок не FAILED
    status,                     // COMPLETED | PARTIAL | INVALID_INPUT | ERROR
    stage,
    fields: {
        bio: { status, requested, error },
        work: { status, requested, skipReason, error },
        education: { status, requested, skipReason, error },
    },
    startedAt, finishedAt, finalUrl, error,
}
```

Статуси поля:

- bio: `UPDATED` | `CLEARED` | `FAILED`
- work / education: `FILLED` | `SKIPPED` | `FAILED`

`SKIPPED` причини: `MISSING_INPUT`, `INCOMPLETE_WORK`, `ALREADY_EXISTS`.

Якщо видиме біо вже дорівнює цілі (або вже порожнє при стиранні) — не битися з неактивним Save, закрити редактор якщо відкрили, поставити успіх.

## Файли

- `facebook/actions/fillFacebookPersonalProfileAbout.js` — action + `facebookPersonalProfileAboutStatuses` + експорт `normalizeFacebookPersonalProfileAboutFields` для тестів
- `facebook/selectors/personalProfileAbout.js` — вкладки, секції, поля, Save, Edit, діалоги
- `test/testFillFacebookPersonalProfileAbout.js` — нормалізація, регістр селекторів, skip/clear, статуси
- `scripts/runTests.js` — додати тест у suite `all`
- Короткий блок у `docs/facebook-api.md` за зразком постів з датами

## Потік

1. `VALIDATE_INPUT` — немає `page` або `fields` не об’єкт → `INVALID_INPUT`.
2. `OPEN_ABOUT` — клік `sk=about`, `waitHuman`, `waitForFunction` що з’явилась бокова панель `sk=directory_intro`.
3. `BIO` — вкладка Intro.
   - Немає біо в JSON і немає `Edit bio` → `CLEARED`.
   - Є `Edit bio` → клікнути її; інакше `About you`.
   - Textarea `Introduce yourself`: Ctrl+A, Backspace, посимвольно як ім’я (`waitRandom` 85–230). Для стирання лише очистити.
   - Дочекатись активного Save (`aria-disabled` немає) → human click.
   - Успіх: немає textarea/Save; для запису текст є; для стирання немає `Edit bio`, є `About you`.
4. `WORK` — якщо requested і не skip: вкладка Work. Після кліку спочатку перевірити/закрити `Leave Page?` (це провал **попереднього** поля, якщо форму не підтвердили).
   - Є `Edit Workplace` → `SKIPPED ALREADY_EXISTS`.
   - Інакше кнопка `Work` → Company combobox → Position (`input[aria-label="Position" i]`) → Save.
   - Успіх: форма зникла, тексти company+position в секції, є `Edit Workplace`.
5. `EDUCATION` — вкладка Education, секція College.
   - Є `Edit college` → skip.
   - Інакше кнопка `College` → combobox `College name` → Save.
   - Одразу після Save чекати або `Invalid Name`, або успіх.
   - `Invalid Name` → Close/OK, поле `FAILED`, далі discard.
   - Успіх: форма зникла, текст коледжу є, є `Edit college`.
6. Якщо останнє поле провалилось і форма ще відкрита — клікнути Intro, на `Leave Page?` натиснути **Leave Page** (`tabindex="0"`).

## Combobox (Company / College)

Після вводу: `waitHuman("short")` + `waitForFunction` що `aria-expanded="true"` і є `li[role="option"]`.

- рівно 1 option і текст починається з `Add "` / `Add “` / `Add «` → клікнути Add
- інакше перший option

Логувати список option-текстів і що саме клікнули.

## Діалоги

`Invalid Name`: закрити OK або Close, поле `FAILED`, не ретраїти.

`Leave Page?` + текст unsaved changes:

- після невдалого Save / при переході далі → **Leave Page** (активна, `tabindex="0"`)
- попереднє непідтверджене поле, якщо ще не `FAILED`, ставити `FAILED`
- Close/Stay не використовувати в цьому сценарії: треба піти далі й скинути брудну форму

## Human-like і React

Шаблон кліку з `AGENTS.md`: wait visible → `waitHuman` → свіжий handle → `humanClickElement`.

Після вкладки, відкриття форми, Save, закриття діалогу — `waitForFunction` на очікуваний DOM, потім `waitHuman("short"|"medium")`. Зовнішній `timeout` для очікувань, без коротких фіксованих `setTimeout`.

Текст: біо й посада посимвольно. Combobox можна `keyboard.type` з delay 35–90, як дату поста.

## Логи

Кожен пошук: селектор або критерій тексту, знайдено/не знайдено, кількість.  
Кожен клік: що і куди.  
Skip / Invalid Name / Leave Page — окремі події.  
`emitLog` / `emitProgress` глушити в try/catch, як у постах з датами.

## Тести (mock, без живого Facebook)

- нормалізація: extra ключі геть; `work` без посади → не requested; `bio: "  "` → clear; `education` не рядок → skip
- селектори з `i` б’ють `Edit Bio` / `EDIT WORKPLACE` / `Leave page?`
- `ALREADY_EXISTS` коли в DOM є Edit-кнопка
- `Invalid Name` → education `FAILED`, action іде далі
- `Leave Page?` після вкладки → попереднє поле `FAILED`, тиснеться Leave Page
- порожній `fields: {}` не `INVALID_INPUT`

Перевірка: `node test/testFillFacebookPersonalProfileAbout.js`. Не `npm test`, не `test:all`, не `scripts/manual`.

## Поза скоупом

Hobbies, High school, дати роботи/навчання, місто, production workflow, ручний AdsPower-скрипт, реальні профілі.
