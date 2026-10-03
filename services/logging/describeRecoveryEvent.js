const reasons = {
    FIRSTMAIL_CODE_TIMEOUT: "Новий лист із відповідним кодом не знайдено за 60 секунд",
    FIRSTMAIL_CREDENTIALS_NOT_FOUND: "У профілі немає повного логіна й пароля Firstmail",
    FIRSTMAIL_AUTH_FAILED: "Firstmail відхилив облікові дані",
    FIRSTMAIL_CONNECTION_FAILED: "Не вдалося підключитися до Firstmail",
    FIRSTMAIL_CONNECTION_LOST: "З'єднання з Firstmail обірвалося",
    FIRSTMAIL_READ_FAILED: "Помилка читання пошти",
    FIRSTMAIL_SEND_REQUIRED: "Запуск на екрані коду без підготовленого слухача; почніть з Get Started",
    FIRSTMAIL_UIDVALIDITY_CHANGED: "Змінилися ідентифікатори скриньки; зупинено читання",
    FIRSTMAIL_MAILBOX_BUSY: "Для цієї пошти вже працює інше очікування коду",
    FIRSTMAIL_DEPENDENCIES_MISSING: "Встановіть залежності через npm install",
    FACEBOOK_CODE_REJECTED: "Facebook відхилив отриманий код",
    RECOVERY_TIMEOUT: "Facebook не показав очікуваний елемент або наступний екран",
    RECOVERY_ABORTED: "Операцію скасовано",
    CREDENTIALS_SAVE_FAILED: "Пароль змінено, але його збереження в AdsPower не підтверджено",
    sender_mismatch: "відправник не відповідає security@facebookmail.com",
    subject_mismatch: "тема не відповідає листу підтвердження Facebook",
    recipient_mismatch: "лист адресовано іншій пошті",
    body_context_mismatch: "у тілі немає тексту підтвердження адреси",
    code_ambiguous: "код у темі та тілі не збігається або знайдено кілька кодів",
    message_too_large: "лист перевищує допустимий розмір",
};

export default function describeRecoveryEvent(event, d = {}) {
    const reason = (value) => reasons[value] ?? value ?? "Причина невідома";
    switch (event) {
        case "state.detected": case "state.observed": return `Екран: ${d.step}`;
        case "click.prepare": return `Готуємо клік: ${d.action}`;
        case "click.complete": return `Клік виконано: ${d.action}`;
        case "input.complete": return `Поле ${d.field} заповнено й перевірено`;
        case "wait.start": return `Очікуємо: ${d.description} (до ${d.timeout / 1000}с)`;
        case "wait.pending": return `Ще очікуємо: ${d.description} (${(d.operationElapsedMs / 1000).toFixed(1)}с)`;
        case "wait.complete": return `Підтверджено: ${d.description}`;
        case "wait.failed": return `Таймаут: ${d.description}`;
        case "mail.auth.start": return "Перевіряємо доступ до Firstmail";
        case "mail.auth.complete": return "Авторизація Firstmail успішна";
        case "mail.connect.start": return "Фіксуємо межу нових листів перед відправленням коду";
        case "mail.listener.ready": return `Слухач готовий; нові листи від UID ${d.uidNext}`;
        case "mail.wait.start": return `Почали відстежувати пошту; таймаут ${d.timeout / 1000}с`;
        case "mail.poll": return `Перевірено пошту: нових листів ${d.foundCount}, від UID ${d.uidFrom}, лишилось ${Math.ceil(d.remainingMs / 1000)}с`;
        case "mail.received": return `Новий лист: UID ${d.uid}`;
        case "mail.ignored": return `Лист UID ${d.uid} відсіяно: ${reason(d.reason)}`;
        case "mail.code.found": return `Код перевірено в листі UID ${d.uid}`;
        case "mail.code.ready": return d.buffered ? "Код збережено до готовності поля Facebook" : "Код передано workflow";
        case "mail.wait.failed": return `${reason(d.code)}; листів отримано ${d.receivedCount}, відсіяно ${d.ignoredCount}${d.lastIgnoreReason ? `; остання причина: ${reason(d.lastIgnoreReason)}` : ""}`;
        case "code.request": return "Екран підтвердження готовий; очікуємо код";
        case "code.received": return `Workflow отримав код із ${d.provider}`;
        case "code.input.start": return "Вводимо код у Facebook";
        case "code.input.complete": return "Введення коду підтверджено";
        case "code.submit.complete": return "Код відправлено на перевірку Facebook";
        case "recovery.failed": return `Recovery не завершено на ${d.step}: ${reason(d.code)}`;
        case "recovery.complete": return "Recovery успішно завершено";
        case "recovery.result": return `Результат: відновлено=${d.recovered}, пароль змінено=${d.passwordChanged}, збережено=${d.credentialsSaved}${d.code ? `; ${reason(d.code)}` : ""}`;
        case "account.lock.login_error": return "Профіль позначено Login Error";
        default: {
            const values = Object.entries(d).filter(([key]) => !["sequence", "timestamp", "elapsedMs", "event"].includes(key));
            return `${event}${values.length ? ` ${JSON.stringify(Object.fromEntries(values))}` : ""}`;
        }
    }
}
