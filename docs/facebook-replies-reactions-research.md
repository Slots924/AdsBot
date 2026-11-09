# Дослідження reply та реакцій Facebook

Спостереження отримані 9 листопада 2026 року у браузері профілю AdsPower 2726 на тестовому permalink-пості. Далі через HTTP перевірено reply, вкладений reply, читання та зміну реакцій. Контрольний діалог двох учасників виконано на профілях 2726 і 2725. `doc_id` та склад GraphQL можуть змінюватися. Службові параметри, cookie, токени та ідентифікатори профілю тут не збережені.

## Reply

Публікація відповіді на коментар використовує `POST /api/graphql/`, `fb_api_req_friendly_name=useCometUFICreateCommentMutation`, `doc_id=28865832786377560`. Сервер повернув HTTP 200 без GraphQL-помилки, а тестова відповідь відобразилася на сторінці. Ця сама mutation вже реалізована для звичайних коментарів у `facebook/autoupload/actions/comments/createComment.js`.

Для reply `input.reply_comment_parent_fbid` містить закодований GraphQL ID безпосереднього батька, а не числовий legacy ID; `input.reply_target_clicked` дорівнює `true`. `input.feedback_id` містить feedback кореневого коментаря гілки, включно з відповіддю на reply. Передавання власного feedback вкладеного reply не підтвердило створення нового вузла. HTTP-публікація працює без автоматичної згадки автора з `message.ranges: []`. Використовуються `feedLocation: "POST_PERMALINK_DIALOG"` і `feedbackSource: 2`. Успіх підтверджено ID нового вузла, правильним feedback і `comment_direct_parent.id`.

## Реакції

Для лайка і його видалення на пості та коментарі браузер надсилав `CometUFIFeedbackReactMutation`, `doc_id=27646120298312844`, через `POST /api/graphql/`. Поле `input.feedback_id` визначає ціль, `input.feedback_reaction_id` для Like дорівнювало `"1635855486666999"`, для видалення — `"0"`. Також передавалися `feedback_source: "OBJECT"`, `is_tracking_encrypted: true`, `tracking`, `actor_id`, `client_mutation_id`, `session_id`, `attribution_id_v2` та поля downstream share session; на верхньому рівні — `scale`, `canUseNicknameOnComet`, `useDefaultActor` і relay-параметр короткої назви реакції.

У відповіді після встановлення реакції `viewer_feedback_reaction_info` містить її ID, після видалення — `null`. Для поста і коментаря встановлено та прибрано кожну реакцію з таблиці; всі ці mutation повернули HTTP 200 без GraphQL-помилок.

| Реакція | `feedback_reaction_id` |
| --- | --- |
| Like | `1635855486666999` |
| Love | `1678524932434102` |
| Care | `613557422527858` |
| Haha | `115940658764963` |
| Wow | `478547315650144` |
| Sad | `908563459236466` |
| Angry | `444813342392137` |
| Видалення | `0` |

У браузері при встановленні й видаленні реакції коментаря також спостерігалася `useCometUFICommentUnvoteMutation` (`doc_id=25722792667420652`) з `input.actor_id`, `client_mutation_id` і `comment_id`. HTTP-тест успішно встановив і прибрав реакцію без цього запиту. Поля attribution/downstream та браузерне tracking для перевірених HTTP-операцій не знадобилися. Заміна вже встановленої реакції на іншу наживо окремо не перевірялася.

## Перевірка власної реакції коментарів

Під час зміни сортування коментарів браузер викликав `CommentListComponentsRootQuery`, `doc_id=28607664095599849`, з `commentsIntentToken`, `id`, `feedLocation: "POST_PERMALINK_DIALOG"`, `feedbackSource: 2`, `scale`, `useDefaultActor` та relay-параметрами. У відповіді зустрічалося `viewer_feedback_reaction_info`: `null` без реакції та об'єкт з ID Like після її встановлення. Це підтверджено повторним завантаженням списку з поставленим лайком; після перевірки лайк прибрано.

HTTP-реалізація не потребує токена сортування: GET поста з `comment_id` повертає початкові JSON-дані. Спочатку підтверджується Story потрібного поста, потім вузол потрібного коментаря за GraphQL ID, legacy ID та feedback ID. Поле реакції міститься, зокрема, у `comment_action_links[].comment.feedback`. Читач зіставляє feedback ID всередині підтвердженого поста. Значення `null` означає відсутність реакції лише коли поле присутнє; незавантажений коментар або відсутнє поле повертають невідомий стан.

## Реалізація

Екшени перевикористовують `createComment`, GraphQL-транспорт і HTTP-сесію автозаливів. Контракти, правила черги та перевірки описані у [facebook-http-comments.md](facebook-http-comments.md). Непідтверджений POST не повторюється. Ідентифікатори GraphQL та структура сторінки можуть змінюватися.
