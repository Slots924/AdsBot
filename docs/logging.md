# Logger і звіти AdsBot

Desktop GUI використовує один `AppLogger`. Він записує структуровані JSONL-події
в `data/logs`, передає безпечну копію події у renderer та переносить контекст
фонової задачі через `AsyncLocalStorage`.

## Формат і безпека

Подія містить `id`, `timestamp`, `level`, `scope`, `event`, `message`, `context`
і `fields`. Секретні ключі, access tokens, cookies, authorization, proxy
credentials, UTM і паролі приховуються до запису у файл та до IPC. Stack trace
зберігається тільки у файловому sink.

Файли мають формат `adsbot-YYYY-MM-DD[-part].jsonl`, сегментуються після 10 MB
і зберігаються максимум 30 днів та 100 MB. Logger не повинен зупиняти робочу
операцію через помилку файлової системи. Перед виходом Electron викликає
`flush()`.

Режим `info` є стандартним. `debug` вмикається у налаштуваннях GUI й впливає
лише на нові записи.

## Звіти

`TaskReportManager` зберігає по одному JSON у `data/reports/tasks` для кожного
фінального стану задачі. Видалення задачі з task journal не видаляє звіт.
Markdown формується лише вручну через вкладку «Журнал → Звіти».

Публікація постів є задачею типу `publication` і використовує глобальний ресурс
`facebook-page-publish`, тому всі публікації виконуються послідовно. IPC
`post:publish` одразу повертає `{ taskId, task }`.

## IPC

- `logs:list`, `logs:scopes`, `logs:level-set`, `logs:renderer-write`;
- `reports:list`, `reports:get`, `reports:delete`,
  `reports:export-markdown`;
- події наживо надходять через `log:event`.

Renderer ніколи не читає log/report файли напряму.
