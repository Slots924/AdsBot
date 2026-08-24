# План: Покращення захоплення URL поста після публікації (capture post URL timing)

## Проблема
У `publishFacebookPersonalProfileMediaPostsWithDates` + `publishFacebookPersonalProfileMediaPost`:
- Пост успішно публікується (діалог закривається, статус PUBLISHED).
- Але `postUrl` часто не захоплюється → `POST_URL_CAPTURE_FAILED`.
- Через це пропускається фаза зміни дат (`datePhaseStarted=true`, але `dateChangedCount=0`).
- Користувач бачить у звітах: "пости опублікували але не змогли отримати точний урл".

## Коренева причина (з коду)
У `facebook/actions/publishFacebookPersonalProfileMediaPost.js:531-545`:

```js
await page.waitForFunction( () => !document.querySelector(createPostDialog) );
if (capturePostUrl) {
    stage = "CAPTURE_POST_URL";
    postUrl = await waitForNewPostPermalink(page, previousPermalinks, Math.min(timeout, 30000), sleep);
}
```

- Snapshot попередніх посилань робиться **до** кліку (поки діалог відкритий).
- Після `waitForFunction` на зникнення діалогу — **немає жодної стабілізації**.
- `waitForNewPostPermalink` одразу починає polling (кожні 250мс, max 30с).
- Facebook закриває діалог оптимістично. Реальний пост з permalink'ом з'являється в `div[role="main"]` з затримкою (мережа, рендер, feed update).

`waitForNewPostPermalink` (lines 139-159) просто шукає перше `href`, якого не було в `previousPermalinks`.

У batch (publish...WithDates.js:192-213) відсутність `postUrl` при успіху публікації → `POST_URL_CAPTURE_FAILED` і skip дат.

## Гіпотеза користувача
"Пост публікується, це займає час, а ми одразу шукаємо URL ще до того як він з'явився."

Підтверджено інспекцією коду.

## Запропоноване рішення користувача
Після публікації (після закриття діалогу) додати:
- чекати 5с до появи нового поста
- повторити 3 рази (сумарно до 15с очікування)

## Рішення (після обговорення)
Вибрано варіант **A** (стабілізація + існуючий polling).

**Точна реалізація:**
- Після `waitForFunction` на зникнення діалогу (перед `if (capturePostUrl)`) додати одну стабілізаційну паузу.
- Використовувати існуючий механізм `waitHuman` + `timingOptions` для консистентності з іншими місцями.
- Потім запустити поточний `waitForNewPostPermalink` (який вже має polling до 30с).

**Чому не цикл 5с x3 як заміна polling:**
- Поточний polling вже робить повторні перевірки.
- Фіксований цикл 15с + polling = надто довго на пост (в batch для кількох постів це накопичується).
- Простіше і менш ризиковано: одна стабілізація + довіряємо polling.

**Місце зміни:**
`facebook/actions/publishFacebookPersonalProfileMediaPost.js` в блоці `stage = "PUBLISH"` після рядка з `waitForFunction` для діалогу.

Приклад (орієнтовний):
```js
await page.waitForFunction(... діалог зник ...);

// НОВЕ: стабілізація, щоб пост встиг з'явитися в фіді
if (capturePostUrl) {
    await waitHuman("long", timingOptions);   // ~3-5s human-like
}

if (capturePostUrl) {
    stage = "CAPTURE_POST_URL";
    postUrl = await waitForNewPostPermalink(...);
}
```

Або, якщо хочемо точно 5с:
```js
if (capturePostUrl) {
    await (sleep ? sleep(5000) : new Promise(r => setTimeout(r, 5000)));
}
```

Рекомендація в плані: використати `waitHuman("long", timingOptions)` (консистентно з іншими "long" стабілізаціями в цьому файлі, напр. перед публікацією).

## Обсяг змін
- Тільки `publishFacebookPersonalProfileMediaPost.js` (функція `publishFacebookPersonalProfileMediaPost`).
- Ніяких змін у batch (`publish...WithDates.js`), selectors, timing.js тощо.
- capturePostUrl використовується тільки в цьому місці (з batch).

## Вплив
- Кожен пост з `capturePostUrl: true` отримає додаткову ~3-5с перед початком polling.
- Збільшить шанс отримати `postUrl`.
- У batch це дозволить пройти в фазу `CHANGE_ALL_DATES`.
- Для 4 постів (як у test_caren) — +12-20с загалом (прийнятно).

## Ризики та edge cases
- Затримка може бути >5с (мережа, великий медіа, A/B Facebook). В такому випадку polling все одно працює до 30с.
- Якщо пост з'являється дуже швидко — зайва пауза (але human-like, не критично).
- Snapshot попередніх посилань робиться з відкритим діалогом — після закриття можуть "з'явитися" старі посилання, які раніше були не visible. Поточна логіка `find first not in known` може в теорії підхопити не той пост. Стабілізація не вирішує це повністю (може знадобитися пізніше).
- Не чіпає випадки без `capturePostUrl`.
- Не впливає на publish success (post все одно вважається PUBLISHED).

## Логування
Додати явний лог в стадії CAPTURE_POST_URL:
- "Чекаємо стабілізації перед пошуком нового permalink (щоб пост з'явився в фіді)"
- Після паузи: "Починаємо пошук нового post URL"

Це допоможе в дебагінгу (користувач просив "по ітого звіт шоб понять на якому кроці").

## Валідація
1. Запустити `node test/test_caren.js` (профіль 1881, фото з `.../Man/1`, випадкові дати 1-3 роки тому).
2. Перевірити у звіті:
   - `publishedCount === requestedCount`
   - `capturedUrlCount === requestedCount`
   - `action.items[].postUrl` присутні і валідні
   - `status === COMPLETED` (або принаймні не POST_URL_CAPTURE_FAILED)
   - `datePhaseStarted === true`
3. Перевірити, що дати потім успішно змінюються (бо тепер є URL).
4. Перевірити логи: з'явився запис про стабілізацію.
5. Запустити існуючі mock-тести (`npm test` або конкретний для media post), щоб не зламати контракт.
6. Опціонально: ручний запуск через `scripts/manual/publishFacebookPersonalProfileMediaPostsWithDates.js` з --confirm.

## Відкриті питання (на момент створення плану)
- Точне значення затримки: `waitHuman("long")` (~3-5с) чи жорсткі 5000мс?
- Чи робити затримку **тільки** коли `capturePostUrl === true`, чи завжди після publish в цьому файлі?
- Чи потрібно оновлювати документацію (docs/facebook-api.md)?

## Порядок реалізації (для іншого агента)
1. У файлі `facebook/actions/publishFacebookPersonalProfileMediaPost.js`:
   - Після `await page.waitForFunction( діалог зник )` додати стабілізаційну паузу (з умовою `if (capturePostUrl)`).
   - Додати лог перед/після паузи.
2. Перевірити, що `timingOptions` / `sleep` доступні в цьому місці (вони є).
3. Запустити релевантні тести.
4. Запустити `test/test_caren.js` і перевірити, що тепер захоплюються URL і фаза дат проходить.
5. Якщо потрібно — скоригувати значення затримки на основі реальних спостережень.

## Позаспек
- Не чіпаємо стратегію snapshot'у попередніх посилань (вона робиться з відкритим діалогом).
- Не додаємо скрол, reload, network interception або пошук по контенту поста (це може бути наступним кроком, якщо 5с не вистачить).
- Не міняємо batch логіку (вона вже коректно реагує на відсутність URL).

План готовий до імплементації.
