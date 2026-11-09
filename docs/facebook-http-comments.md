# HTTP-коментарі, реплаї та реакції

Усі екшени працюють через готовий `fbData` з `FacebookWebClient`, без браузера.
Третій аргумент — `{ signal, beforeSend? }`; `beforeSend` застосовується до mutation.
Службові параметри й токени викликач не передає. Взаємодія з AdsPower залишається
в класі `AdsPower`; сесія використовує поточну проксі профілю без зміни чи ротації.

## Екшени

| Модуль у `facebook/autoupload/actions/` | Другий аргумент | Основний результат |
| --- | --- | --- |
| `posts/getPostContext` | `{ postUrl }` | `available`, `postTarget`, `reactionKnown`, `reaction`, `reactionError` |
| `reactions/getPostReaction` | `{ postTarget }` | `reaction` потрібного поста |
| `reactions/getCommentReaction` | `{ commentTarget }` | `reaction` потрібного коментаря |
| `reactions/setPostReaction` | `{ postTarget, reaction }` | `APPLIED`, `REMOVED` або `UNCHANGED` |
| `reactions/setCommentReaction` | `{ commentTarget, reaction }` | `APPLIED`, `REMOVED` або `UNCHANGED` |
| `comments/createComment` | `{ feedbackId, text, postTarget? }` | `CREATED`, ID та `commentTarget` |
| `comments/createReply` | `{ parentCommentTarget, text }` | `CREATED`, ID та `commentTarget` із батьком |

`reaction` для встановлення — `like`, `love`, `care`, `haha`, `wow`, `sad`, `angry`;
`null` прибирає реакцію. При читанні це `null` або `{ name, id }`.

`postTarget`: `{ postId, storyId, postFeedbackId, postUrl }`.
`commentTarget`: `{ commentId, legacyCommentId, commentFeedbackId, postFeedbackId,
postUrl, commentUrl, parentCommentId, threadFeedbackId }`.
Цілі повертають читачі й екшени публікації; їх не потрібно складати вручну.
Для реакції використовується власний `commentFeedbackId`, а для наступної відповіді
в гілці — `threadFeedbackId` кореневого коментаря. `reply_comment_parent_fbid`
при цьому містить GraphQL `commentId` безпосереднього батька, включно з reply.

Спільні поля: `success`, `outcome`, `code`, `message`, `mutationAttempted`,
`outcomeUnknown`, `retryable`, HTTP/GraphQL-діагностика, `actionId`, `exchanges`.
У задачах і сховищі залишаються компактні результати та `httpHistory`.

## Підтвердження результату

- Пост підтверджується об’єктом Story з потрібною адресою/ID та його feedback.
  Перенаправлення на вхід, загальна HTML-сторінка або HTTP 200 недостатні.
- Власна реакція читається лише з feedback відповідного ID. Для коментаря також
  зіставляються GraphQL ID та legacy ID. Неповне завантаження повертає помилку,
  а не `reaction: null`. GET використовує адресне фокусування через `comment_id`.
- `getPostContext` може підтвердити пост за невідомої реакції: тоді `success: true`,
  `available: true`, `reactionKnown: false` та пояснення в `reactionError`.
  Окремий читач реакції за такого стану повертає `success: false`.
- Створення вимагає ID нового коментаря та правильного feedback у відповіді;
  reply додатково вимагає правильного `comment_direct_parent.id`.
- Реакція вимагає потрібного ID або явного `null` у feedback цілі. За неповної
  mutation-відповіді виконується один контрольний GET без повтору POST.
- `UNCHANGED` є успіхом без mutation. Timeout, пошкоджена відповідь та частковий
  результат із GraphQL-помилкою не запускають повторну mutation.

Читання HTML не гарантує завантаження будь-якого коментаря великого поста:
якщо фокусований коментар не повернувся, екшен чесно повідомляє, що стан невідомий.

## Черга «Фанпейджі → AU Comments»

`AutouploadService.publishDialogue(ids, { postUrl, commentRows }, context)` резервує
профілі та запускає `services/autoupload/commentDialogue.js`. Плоске коментування
вкладки автозаливів через `publishComments` зберігає попередню поведінку.

Підготовка перевіряє ID, цикли та стать `profile_key` і впорядковує батьків перед
дітьми. Авторські й вимкнені рядки не публікуються, без підтвердженого батька
реплай пропускається. Учасник отримує профіль потрібної статі; після успіху
прив’язка фіксується й не замінюється. Кожен новий учасник без прив’язки потребує
вільного профілю. Звичайний коментар може перейти до іншого профілю після явної
відмови; reply має одну спробу, включно з підготовкою профілю. Невідомий POST
закриває цей рядок і його нащадків без повтору, незалежні гілки продовжуються.

Перед першою публікацією профілю перевіряється пост і реакція. Якщо реакції
немає — окремий екшен ставить рівноймовірно Like, Love або Wow. Наявна реакція
зберігається. Збій реакції дає попередження, але дозволяє коментар за робочої
сесії; невідома реакція не змінюється. Реакції коментарів доступні окремими
екшенами та автоматично в цій черзі не виконуються.

До мережевих змін зберігається намір спроби; після результату — ID публікації,
призначення учасників і статуси рядків у `AutouploadStore.commentDialogues`.
Запуск автоматично не відновлюється після аварії. Статус `started` без кінцевого
результату вимагає перевірки HTTP-історії перед новим запуском.
Збій збереження результату зупиняє чергу. Підтверджений успіх не повторюється
через помилку лічильника; коментар збільшує `AU_COMMENT`, reply — `AU_REPLY`.

Короткий звіт містить підсумок та таблицю рядків: батько, тип, профіль, результат,
причина й адреса успішної публікації. Повні спроби, призначення та ID залишаються
у структурованому результаті, HTTP-історія приєднується до наявного звіту задачі.

## Перевірки

- `npm run test:autoupload` — mock-перевірки екшенів, черги, історії та звітів.
- `npm --prefix frontend run test -- src/test/fanpage-au-comments.test.jsx` — дерево і короткий звіт.
- `node scripts/checkFanPageAuCommentsUi.js` — прихований Electron на чотирьох розмірах.
- `node scripts/manual/testCommentDialogueHttp.js <profileNo> <postUrl> [secondProfileNo]`
  — реальний HTTP-тест: кореневий коментар, reply та повернення першого учасника.
  Скрипт публікує ці повідомлення, може поставити реакцію на пост і збільшує
  лічильники успішних дій. Звіт зберігається в `artifacts/http-comment-dialogue-check`.

9 листопада 2026 року на профілях 2726 і 2725 контрольний діалог успішно створив
коментар і два reply, повторно використав першого учасника й підтвердив усі три
публікації адресним HTTP-читанням. Встановлення та видалення реакцій поста й
коментаря через HTTP перевірено окремо; `CommentUnvoteMutation` для них не потрібна.
