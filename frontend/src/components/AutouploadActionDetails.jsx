const requiredActions = {
    authenticate_account: "Увійдіть у Facebook у профілі AdsPower",
    confirm_account: "Пройдіть підтвердження акаунта у Facebook",
    refresh_session: "Оновіть сесію профілю",
    check_friendship_status: "Перевірте стан заявки у Facebook перед новою спробою",
    check_ad_account_permissions: "Перевірте фактичні права користувача у рекламному кабінеті перед повтором",
    confirm_admin_access: "Підтвердьте надання Admin-доступу до вибраного РК",
};

export default function AutouploadActionDetails({ entry }) {
    if (!["friend-request", "ad-account-share"].includes(entry.operation)) return null;
    const diagnostics = [
        ["Рекламний кабінет", entry.adAccountId], ["Отримувач", entry.targetUserId], ["Результат", entry.outcome], ["Код застосунку", entry.code],
        ["HTTP", entry.httpStatus], ["Код Facebook", entry.graphCode], ["Підкод Facebook", entry.graphSubcode],
        ["API error code", entry.apiErrorCode], ["Тип помилки", entry.graphType], ["Trace ID", entry.traceId], ["Request ID", entry.metaRequestId],
    ].filter(([, value]) => value !== null && value !== undefined && value !== "");
    return <div className="autoupload-action-details">
        <p className={`autoupload-status ${entry.success ? "success" : entry.outcomeUnknown ? "warning" : "danger"}`}>{entry.message}</p>
        <dl>{diagnostics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>
        {entry.actionRequired && <p>{requiredActions[entry.actionRequired] || entry.actionRequired}</p>}
        {entry.errors?.length > 0 && <ul>{entry.errors.map((error, index) => <li key={index}>{error.message}{error.code != null ? ` · code: ${error.code}` : ""}{error.api_error_code != null ? ` · api_error_code: ${error.api_error_code}` : ""}{error.error_subcode != null ? ` · subcode: ${error.error_subcode}` : ""}</li>)}</ul>}
    </div>;
}
