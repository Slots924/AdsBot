# План: Відкривати перший пост по даті (`__cft__`) і одразу міняти дату

## Проблема

Після публікації permalink у стрічці ще немає. React підставляє його лише після кліку по даті. Старий пошук `story_fbid` / `/posts/` / `/videos/` у `div[role="main"]` через це майже завжди дає `postUrl = null` і `POST_URL_CAPTURE_FAILED`. Фаза дат не стартує.

Обкладинка і фото поста живуть як `/photo/?fbid=...`. Брати “найвище посилання” не можна.

## Рішення (зафіксовано)

Один пост за раз, та сама вкладка, без нової вкладки і без шляху `children[12]`.

1. Опублікувати пост через наявний `publishFacebookPersonalProfileMediaPost` з `capturePostUrl: false`.
2. Дочекатися першої картки `[aria-posinset="1"]`.
3. У ній взяти **перший** `a[href*="?__cft__[0]="]`, навестись і клікнути (human-like).
4. Дочекатися модалки поста (`postDialogSelector` уже є).
5. Записати `postUrl` з `page.url()` або з посилання в діалозі.
6. Викликати наявний `changeFacebookPersonalProfilePostDate` з `postUrl: null` і `closePostDialog: true` (діалог уже відкритий; не робити `openPageWithoutPopups`).
7. Після закриття модалки повторити для наступного поста.

Якщо `[aria-posinset="1"]` немає перед першою публікацією — профіль без постів у стрічці. Після публікації чекаємо появи картки.

## Чому не чіпаємо

- Шлях по індексах дітей.
- Ctrl+клік і нові вкладки.
- Старий збір усіх `/photo/` у `main` як основний спосіб URL.
- Двофазний цикл “спочатку всі пости, потім усі дати”.

## Потік даних

```
для кожного item:
  fingerprint = відбиток поточної [aria-posinset="1"] або null
  publish(...) → success?
  чекати, поки перша картка з’явилась і відбиток змінився
  клікнути перший a[href*="?__cft__[0]="]
  чекати post dialog
  item.postUrl = page.url() або permalink з діалогу
  changeDate({ postUrl: null, targetDate, closePostDialog: true })
```

Відбиток картки: нормалізований `href` першого `__cft__` посилання (прибрати службові параметри крім ідентифікатора, або порівнювати рядок до `__cft__` / повний href як є, але після кліку Facebook його міняє). Надійніше: до публікації зберегти весь перший `href` як є; після публікації чекати, поки перший `__cft__` у `[aria-posinset="1"]` **інший** або картки раніше не було.

Таймаут очікування — зовнішній `timeout` екшену, не фіксовані 10–15 с. Короткий `waitHuman` лише як стабілізація React після публікації та після закриття модалки.

## Файли

- `facebook/selectors/personalProfilePost.js` — селектори картки і `__cft__` посилання.
- `facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js` — замінити дві фази на цикл publish → open first card → change date.
- Новий невеликий хелпер (краще окремий файл поруч, щоб не роздувати batch): наприклад `facebook/actions/openFacebookPersonalProfileFirstFeedPost.js` — знайти картку, клікнути перший `__cft__`, дочекатися модалки, повернути `postUrl`.
- `docs/facebook-api.md` — оновити опис: більше не дві фази; URL береться після кліку по даті.
- `test/testFacebookPersonalProfilePostDate.js` — mock на новий цикл (немає картки / є картка / клік відкрив діалог).
- `publishFacebookPersonalProfileMediaPost.js` — не ламати; у batch просто не вмикати `capturePostUrl`.

Закриття модалки вже є в `changeFacebookPersonalProfilePostDate` (`Close` всередині `postDialogSelector`). Окремо кнопку Close не дублювати.

## Деталі реалізації

Селектори:

```js
[aria-posinset="1"]
[aria-posinset="1"] a[href*="?__cft__[0]="]
```

Клік: наявний `humanClickElement` / той самий шаблон, що в інших Facebook actions: wait visible → стабілізація → свіжий handle → human click.

Після кліку: якщо модалка поста не з’явилась — помилка на кшталт `FIRST_FEED_POST_OPEN_FAILED` (перший `__cft__` міг бути ім’ям, не датою). Не продовжувати зміну дати.

`item.postUrl` заповнювати після відкриття, щоб `capturedUrlCount` лишився змістовним.

Якщо публікація впала — цей item з помилкою, дату не міняти, цикл зупинити (як зараз на `PUBLISH_PARTIAL`), щоб не клікати чужий старий пост.

Логи українською на кожному кроці: чекаємо картку, клікаємо дату, відкрили пост, URL, змінюємо дату, закрили.

## Ризики

- Перший `__cft__` може бути ім’ям автора, не датою. Захист: обов’язкове очікування модалки поста. Якщо на реальному профілі це повториться — звузити кандидатів (наступний крок, не зараз).
- Після зміни дати пост може зникнути з верху. Наступна ітерація орієнтується на зміну відбитка, не на “картка просто є”.
- `page.url()` інколи лишається `/me`. Тоді читати permalink з відкритого діалогу (`story_fbid`, `/posts/`, `/photo/?fbid=`).
- `__cft__` — службовий параметр Facebook; якщо його приберуть, селектор треба буде міняти. Це прийнятий орієнтир користувача.

## Перевірка

1. `node test/testFacebookPersonalProfilePostDate.js`
2. `node test/testPublishFacebookPersonalProfileMediaPost.js` — контракт одиночної публікації не зламаний.
3. `npm run test:campaign` не обов’язковий для цієї ділянки; достатньо двох тестів вище, якщо campaign-набір не зачіпає ці файли.
4. Живий `test/test_caren.js` — лише за прямою вказівкою користувача.

Очікуваний живий результат: `publishedCount === requestedCount`, `capturedUrlCount === requestedCount`, `dateChangedCount === requestedCount`, `status === COMPLETED`.
