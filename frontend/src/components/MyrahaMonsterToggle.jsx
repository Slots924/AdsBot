import { LoaderCircle, RefreshCw } from "lucide-react";

export default function MyrahaMonsterToggle({ pageId, moderation }) {
    const id = String(pageId);
    const page = moderation.pages[id];
    const busy = Boolean(moderation.busy[id]);
    const error = moderation.errors[id];
    const loading = moderation.status === "loading";
    let message = "";
    if (moderation.status === "unconfigured") message = "Додайте API-ключ у Налаштування → Інтеграції";
    else if (moderation.status === "error") message = moderation.message || "Не вдалося перевірити стан";
    else if (loading) message = "Перевіряємо стан MyrahaMonster…";
    else if (error) message = error.message;
    else if (!page) message = "Немає доступу до фанпейджі в MyrahaMonster";
    else if (!page.integrationReady) message = "Немає доступної підписки MyrahaMonster";
    else message = page.enabled ? "Автоприховування увімкнено" : "Автоприховування вимкнено";
    const disabled = busy || moderation.status !== "ready" || !page?.integrationReady || Boolean(error);
    const retry = moderation.status === "error" || (error && !error.unavailable);

    return <div className={`myraha-control${busy || loading || retry ? " myraha-pending" : ""}`} title={`Приховування коментарів: ${message}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <label className="myraha-toggle">
            <input type="checkbox" role="switch" aria-label={`Приховування коментарів ${id}`}
                aria-describedby={`myraha-status-${id}`} checked={page?.enabled === true} disabled={disabled}
                onChange={(event) => moderation.toggle(id, event.target.checked)} />
        </label>
        {(busy || loading) && <LoaderCircle className="spin" size={14} role="status" aria-label={`Запит MyrahaMonster ${id}`} />}
        {retry && !busy && !loading && <button type="button" className="icon-button" aria-label={`Перевірити приховування ${id}`}
            onClick={() => moderation.status === "error" ? moderation.refresh() : moderation.check(id)}><RefreshCw size={13} /></button>}
        <small id={`myraha-status-${id}`} className={error || moderation.status === "error" ? "myraha-error" : ""}>{message}</small>
    </div>;
}
