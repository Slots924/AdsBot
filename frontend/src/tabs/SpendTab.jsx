import { useEffect, useMemo, useState } from "react";
import { ArrowUpToLine, RefreshCw, Search } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


function formatMoney(value, currency = "") {
    return `${Number(value || 0).toLocaleString("uk-UA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}${currency ? ` ${currency}` : ""}`;
}


function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("uk-UA");
}


function formatGroupedTotal(totalsByCurrency, field) {
    const entries = Object.entries(totalsByCurrency ?? {});
    if (entries.length === 0) return "0,00";
    return entries.map(([currency, totals]) => (
        formatMoney(totals[field], currency === "—" ? "" : currency)
    )).join(" · ");
}


const statusLabels = {
    synced: "Передано",
    pending: "Очікує",
    "mapping-missing": "Немає відповідності",
    "mapping-ambiguous": "Кілька відповідностей",
};


export default function SpendTab({ tasks = [], onError = () => {}, showToast }) {
    const [overview, setOverview] = useState({ totals: {}, campaigns: [], settings: {} });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const collectBusy = tasks.some((task) => task.type === "spend-collect" && ["queued", "running"].includes(task.status));
    const exportBusy = tasks.some((task) => task.type === "spend-export-keitaro" && ["queued", "running"].includes(task.status));
    const taskSignature = tasks
        .filter((task) => task.type?.startsWith("spend-"))
        .map((task) => `${task.id}:${task.status}`)
        .join("|");

    const load = async () => {
        setLoading(true);
        try {
            setOverview(await unwrap(window.adsBot.getSpendOverview()));
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити спенд" });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [taskSignature]);

    const run = async (operation, message) => {
        try {
            await unwrap(operation());
            showToast?.(message, "success");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося запустити задачу спенду" });
        }
    };
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return overview.campaigns;
        return overview.campaigns.filter((item) => [
            item.name,
            item.campaignId,
            item.adAccountId,
            item.keitaroCampaignId,
        ].some((value) => String(value ?? "").toLowerCase().includes(needle)));
    }, [overview.campaigns, search]);
    const currencyCount = Object.keys(overview.totalsByCurrency ?? {}).length;

    return (
        <div className="spend-page">
            <header className="spend-heading">
                <div><span className="eyebrow">Meta → Keitaro</span><h1>Спенд</h1><p>Локальна історія витрат і контроль передачі у трекер.</p></div>
                <div className="spend-actions">
                    <button className="secondary-button" disabled={collectBusy} onClick={() => run(window.adsBot.startSpendCollection, "Збір спенду додано до черги")}><RefreshCw size={15} className={collectBusy ? "spin" : ""}/> {collectBusy ? "Збираємо…" : "Оновити з Meta"}</button>
                    <button className="primary-button" disabled={exportBusy} onClick={() => run(window.adsBot.startSpendExport, "Передачу спенду додано до черги")}><ArrowUpToLine size={15}/> {exportBusy ? "Передаємо…" : "Відправити в Keitaro"}</button>
                </div>
            </header>
            <section className="spend-summary">
                <article><small>Зібрано</small><strong>{formatGroupedTotal(overview.totalsByCurrency, "spend")}</strong><span>{currencyCount > 1 ? "Окремо за валютами" : "Всього у базі"}</span></article>
                <article><small>Передано</small><strong>{formatGroupedTotal(overview.totalsByCurrency, "exported")}</strong><span>З урахуванням комісії</span></article>
                <article><small>Очікує</small><strong>{formatGroupedTotal(overview.totalsByCurrency, "pending")}</strong><span>З урахуванням комісії</span></article>
                <article><small>Останній збір</small><strong className="spend-date-value">{formatDate(overview.settings.lastCollectionRunAt)}</strong><span>Округлення до 15 хв</span></article>
            </section>
            <div className="spend-toolbar">
                <label><Search size={15}/><input aria-label="Пошук спенду" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Кампанія, Meta ID, рекламний акаунт…"/></label>
                <span>Остання передача: {formatDate(overview.settings.lastExportRunAt)}</span>
                <button className="icon-button" aria-label="Оновити таблицю спенду" onClick={load}><RefreshCw size={15}/></button>
            </div>
            <section className="spend-table">
                <div className="spend-row spend-head"><span>Кампанія</span><span>Рекламний акаунт</span><span>Спенд</span><span>Зміна</span><span>Keitaro</span><span>Оновлено</span><span>Статус</span></div>
                <div className="spend-table-body">
                    {rows.map((item) => <div className="spend-row" key={item.campaignId}>
                        <span><strong>{item.name || "Без назви"}</strong><small>Meta ID {item.campaignId}</small></span>
                        <span>{item.adAccountId}</span>
                        <span className="numeric">{formatMoney(item.spend, item.currency)}</span>
                        <span className={`numeric ${item.lastDelta < 0 ? "negative" : item.lastDelta > 0 ? "positive" : ""}`}>{item.lastDelta > 0 ? "+" : ""}{formatMoney(item.lastDelta, item.currency)}</span>
                        <span>{item.keitaroCampaignId ? `ID ${item.keitaroCampaignId}` : "—"}</span>
                        <span>{formatDate(item.collectedAt)}</span>
                        <span><i className={`spend-status ${item.status}`}>{statusLabels[item.status] ?? item.status}</i></span>
                    </div>)}
                    {!loading && rows.length === 0 && <div className="empty-state">Спенд ще не зібрано.</div>}
                    {loading && <div className="empty-state">Оновлюємо таблицю…</div>}
                </div>
            </section>
        </div>
    );
}
