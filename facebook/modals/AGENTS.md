# Модалки після публікації поста

Кожне вікно — окремий файл у цій папці.
Детект за заголовком без урахування регістру.
Кліки тільки human-like: wait visible → пауза React → свіжий handle → клік.
Після кліку чекати зміну DOM, не читати результат одразу.

## Як додати нове вікно

1. Селектори — у `facebook/selectors/postPublishModals.js`.
2. Файл `facebook/modals/<назва>.js` з `match(snapshot)` і `handle(page, options)`.
3. Підключити в `knownPostPublishModals` у `handlePostPublishModals.js`.

## Відомі вікна

### Review audience (`reviewAudience.js`)

- Коли: одразу після «What's on your mind?» і також після кнопки Post.
- Заголовок містить `Review audience`.
- Дія: Continue, потім Public, потім Save.

### Who can see your future posts (`futurePostsAudience.js`)

- Коли: після Continue в Review audience.
- Заголовок містить `Who can see your future posts`.
- Дія: Public, потім Save.
