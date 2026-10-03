# Браузерне запрошення до БМ

`facebook/api-actions/ads-manager/inviteBusinessUser.js` виконує одну mutation `BizKitSettingsInvitePeopleModalMutation` у поточній сесії `business.facebook.com`. Запрошення може містити повний доступ до вибраних фанок і рекламних акаунтів. GUI автоматично до цього action не підключається.

```js
import inviteBusinessUser from "../facebook/api-actions/ads-manager/inviteBusinessUser.js";

const result = await inviteBusinessUser({
    page,
    commonPayload,
    businessId: "456",
    emails: ["person@example.test"],
    role: "EMPLOYEE",
    financeAccess: true,
    pageIds: ["789"],
    adAccountIds: ["act_987"],
    timeout: 30000,
});
```

Вхід: Puppeteer `page`, актуальний `commonPayload` з браузерної сесії БМ, `businessId` та непорожній масив `emails`. Необов'язкові поля: `role` (`EMPLOYEE` за замовчуванням або `ADMIN`), булевий `financeAccess` (за замовчуванням `true`), масиви `pageIds`, `adAccountIds` (за замовчуванням порожні) та `timeout`. Усі ID передаються рядками; префікс `act_` для РК дозволений. Повторні активи видаляються. Порожні масиви активів дозволяють запросити лише до БМ.

Із `commonPayload` відбираються лише `av`, `__user`, `__a`, `fb_dtsg`, `jazoest`, `lsd`, `__comet_req`. `actor_id` береться з `av`. `__bid` завжди формується з аргументу `businessId`. Інші поля перехопленого запиту не копіюються. Cookies підставляє браузер через `credentials: "include"`, часовий пояс читається з браузера. `doc_id` і friendly name задає action, `client_mutation_id` генерується для кожного виклику.

Набори task ID відповідають наданим прикладам: `EMPLOYEE` з фінансами — три ID, `ADMIN` без фінансів — десять ID, фанки — одинадцять ID, РК — чотири ID. Спільний ID `926381894526285` використовується для `EMPLOYEE` без фінансів; два ID, наявні лише у першому прикладі, трактуються як фінансовий набір та додаються за `financeAccess: true`. Це висновок із порівняння прикладів, а не підтверджене зіставлення назв дозволів Facebook. Комбінації `EMPLOYEE` без фінансів та `ADMIN` з фінансами потребують перевірки реальним браузерним запитом.

Успіх: `{ success: true, status: "PENDING", data: { businessId, role, financeAccess, requests } }`. Кожен елемент `requests` містить `id`, `status`, `expirationTime`. Перевіряються наявність ID, статус `PENDING` і кількість результатів для всіх унікальних email. `PENDING` підтверджує створення запрошення, але не його прийняття чи фактичні права після прийняття.

Помилки повертають `success: false` та статус `INVALID_INPUT`, `REQUEST_TIMEOUT`, `REQUEST_FAILED`, `HTTP_ERROR`, `PARSE_ERROR`, `GRAPHQL_ERROR`, `INVITE_RESULT_UNEXPECTED` або `ERROR`. Для GraphQL-помилок доступні `graphErrors`. Після таймауту чи неповної відповіді результат може бути невизначеним: запрошення могло створитися. Автоматичного повторення немає.

Mock-перевірка: `node test/testInviteBusinessUserAction.js`. Вона перевіряє структуру запиту, вибір дозволів і обробку помилок; фактичні права на сервері Meta не перевіряє.
