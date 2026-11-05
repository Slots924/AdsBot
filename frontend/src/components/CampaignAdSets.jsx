import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, LoaderCircle, Trash2, X } from "lucide-react";
import { unwrap } from "../lib/api.js";
import { localValueInZone, zonedValueToIso } from "../lib/accountTime.js";
import { budgetFromMinorUnits } from "../../../facebook/services/campaigns/CampaignBudget.js";

const money = (value, currency) => value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
const budgetAmount = (row, currency) => budgetFromMinorUnits(Number(row.lifetimeBudget) > 0 ? row.lifetimeBudget : row.dailyBudget ?? 0, currency);
const statuses = {
    ACTIVE: "Активний", PAUSED: "Пауза", CAMPAIGN_PAUSED: "Кампанія на паузі", ADSET_PAUSED: "Адсет на паузі",
    PENDING_REVIEW: "На перевірці", DISAPPROVED: "Відхилено", WITH_ISSUES: "Є проблеми", DELETED: "Видалено", ARCHIVED: "В архіві", IN_PROCESS: "Обробка", PENDING_BILLING_INFO: "Потрібна оплата",
};
const removed = (row) => ["DELETED", "ARCHIVED"].includes(row.status) || ["DELETED", "ARCHIVED"].includes(row.effectiveStatus);
const unavailable = (row) => removed(row) || row.missingFromLatestRead || row.setupIncomplete;

function DuplicateAdSetModal({ row, input, account, onClose, onComplete }) {
    const zone = account.timezoneName;
    const [openedAt] = useState(() => zone ? localValueInZone(new Date(), zone) : "");
    const [count, setCount] = useState("1");
    const [budget, setBudget] = useState(() => String(budgetAmount(row, account.currency)));
    const [start, setStart] = useState(openedAt);
    const [createActive, setCreateActive] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");
    const submit = async (event) => {
        event.preventDefault();
        if (busy || result) return;
        setError("");
        const iso = start === openedAt ? null : zonedValueToIso(start, zone);
        if (start !== openedAt && (!iso || Date.parse(iso) <= Date.now())) {
            setError("Оберіть майбутній час або поверніть «Запустити одразу».");
            return;
        }
        setBusy(true);
        try {
            const value = await unwrap(window.adsBot.duplicateAdSet({ ...input, adSetId: row.id, count: Number(count), budget: row.campaignBudget ? null : Number(budget), startTime: iso, createActive }));
            setResult(value);
            try { await onComplete(); } catch { setError("Копії створено, але не вдалося перечитати кеш. Оновіть список."); }
            if (value.error) setError(value.error.message);
        } catch (failure) {
            // Після невизначеної помилки повторний запуск потребує перевірки вже створених копій.
            setResult({ copies: [], error: true });
            setError(failure.message);
        } finally { setBusy(false); }
    };
    useEffect(() => {
        const escape = (event) => { if (event.key === "Escape" && !busy) onClose(); };
        document.addEventListener("keydown", escape);
        return () => document.removeEventListener("keydown", escape);
    }, [busy, onClose]);
    return createPortal(<div className="overlay" onMouseDown={() => !busy && onClose()}>
        <form className="modal adset-duplicate-modal" role="dialog" aria-modal="true" aria-labelledby="adset-duplicate-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
            <button type="button" className="modal-close" aria-label="Закрити" disabled={busy} onClick={onClose}><X size={17} /></button>
            <div className="modal-icon template-icon"><Copy size={22} /></div>
            <h2 id="adset-duplicate-title">Дублювати адсет</h2>
            <p className="adset-source-name">{row.name}</p>
            <fieldset disabled={busy || Boolean(result)}>
                <div className="adset-duplicate-fields">
                    <label className="field"><span>Кількість копій</span><input autoFocus type="number" min="1" max="50" step="1" required value={count} onChange={(event) => setCount(event.target.value)} /></label>
                    {!row.campaignBudget && <label className="field"><span>{Number(row.lifetimeBudget) > 0 ? "Бюджет на весь термін" : "Бюджет на день"} / копія · {account.currency}</span><input type="number" min="0.01" step="0.01" required value={budget} onChange={(event) => setBudget(event.target.value)} /></label>}
                </div>
                {row.campaignBudget && <div className="notice">Спільний бюджет кампанії. Копії використовуватимуть його.</div>}
                <label className="field"><span>Початок показів · {zone || "Часовий пояс невідомий"}</span><input type="datetime-local" step="60" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
                <button type="button" className="adset-now-button" onClick={() => setStart(openedAt)}>Запустити одразу</button>
                <label className={`campaign-default-switch ${createActive ? "active" : ""}`}><input type="checkbox" role="switch" checked={createActive} onChange={(event) => setCreateActive(event.target.checked)} /><span><strong>Увімкнути адсети</strong></span><i aria-hidden="true" /></label>
                <p className="adset-launch-hint">{!createActive ? "Копії будуть створені на паузі." : start === openedAt ? "Запуск одразу після створення та перевірки Meta." : "Запуск за розкладом у часовому поясі РК."} Копіюються також оголошення. Пауза кампанії зберігається.</p>
                {!row.campaignBudget && <div className="adset-budget-total">Загальний бюджет копій <strong>{money(Number(count) * Number(budget), account.currency)}{Number(row.lifetimeBudget) > 0 ? "" : " / день"}</strong></div>}
            </fieldset>
            {result && <div className={`notice ${result.error ? "danger" : ""}`}>Створено копій: {result.copies?.length ?? 0} із {count}.{result.error ? " Операцію зупинено. Перевірте копії в Ads Manager перед повтором." : ""}</div>}
            {error && <div className="notice danger" role="alert">{error}</div>}
            <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{result ? "Закрити" : "Скасувати"}</button>{!result && <button className="primary-button" disabled={busy || !zone} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Copy size={16} />}{busy ? "Дублюємо…" : "Дублювати"}</button>}</div>
        </form>
    </div>, document.body);
}

export default function CampaignAdSets({ campaignId, accountKey, account, datePreset, refreshToken, canWrite }) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [statisticsBusy, setStatisticsBusy] = useState(false);
    const [deletingIds, setDeletingIds] = useState(() => new Set());
    const [error, setError] = useState("");
    const [duplicate, setDuplicate] = useState(null);
    const sequence = useRef(0);
    const deletedIds = useRef(new Set());
    const pendingDeletes = useRef(new Set());
    const input = { accountKey, adAccountId: account.id, campaignId, datePreset };
    const key = JSON.stringify(input);
    const applyData = (next) => setData({ ...next, adSets: next.adSets.map((row) => deletedIds.current.has(String(row.id)) ? { ...row, status: "DELETED", effectiveStatus: "DELETED", spend: null, leads: null, costPerLead: null, cpm: null, ctr: null } : row) });
    useEffect(() => {
        const request = ++sequence.current;
        let alive = true;
        setBusy(true);
        setStatisticsBusy(false);
        setError("");
        (async () => {
            try {
                const cached = await unwrap(window.adsBot.getCampaignAdSets(input));
                if (!alive || sequence.current !== request) return;
                applyData(cached);
                const fresh = await unwrap(window.adsBot.refreshCampaignAdSets(input));
                if (!alive || sequence.current !== request) return;
                applyData(fresh);
                setBusy(false);
                if (fresh.listError || !fresh.adSets.some((row) => !removed(row) && !row.missingFromLatestRead)) return;
                setStatisticsBusy(true);
                const statistics = await unwrap(window.adsBot.refreshCampaignAdSetStatistics(input));
                if (alive && sequence.current === request) applyData(statistics);
            } catch (failure) { if (alive) setError(failure.message); }
            finally { if (alive) { setBusy(false); setStatisticsBusy(false); } }
        })();
        return () => { alive = false; };
    }, [key, refreshToken]);
    const deleteRow = async (row) => {
        const id = String(row.id);
        if (pendingDeletes.current.has(id) || !window.confirm(`Видалити адсет «${row.name}»? Цю дію не можна скасувати.`)) return;
        pendingDeletes.current.add(id);
        setDeletingIds(new Set(pendingDeletes.current));
        setError("");
        try {
            const result = await unwrap(window.adsBot.deleteAdSet({ ...input, adSetId: row.id }));
            deletedIds.current.add(id);
            if (result.data) applyData(result.data);
            else setData((current) => ({ ...current, adSets: current.adSets.map((item) => String(item.id) === id ? { ...item, status: "DELETED", effectiveStatus: "DELETED", spend: null, leads: null, costPerLead: null, cpm: null, ctr: null } : item) }));
            if (result.cacheError) setError(result.cacheError.message);
        } catch (failure) { setError(failure.message); }
        finally {
            pendingDeletes.current.delete(id);
            setDeletingIds(new Set(pendingDeletes.current));
        }
    };
    const rows = data?.adSets ?? [];
    const timestamp = (date) => date ? new Date(date).toLocaleString("uk-UA", { timeZone: account.timezoneName || "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "ще немає";
    return <section className="campaign-adsets" aria-label="Адсети кампанії">
        <div className="adsets-caption"><strong>Адсети <span>{rows.length}</span></strong><small>{(busy || statisticsBusy) && <LoaderCircle className="spin" size={12} />}Статуси: {timestamp(data?.listUpdatedAt)} · Статистика: {timestamp(data?.statisticsUpdatedAt)}{statisticsBusy ? " · оновлюється" : ""}{data?.statisticsStale ? " · попередній період" : ""}</small></div>
        {(error || data?.refreshError) && <div className="notice danger">{error || data.refreshError.message}. Показано збережені дані.</div>}
        {!rows.length && <div className="adsets-empty">{busy ? "Завантажуємо адсети…" : data?.cacheHit ? "У кампанії немає адсетів." : "Збережених адсетів ще немає. Оновіть після відновлення доступу."}</div>}
        {rows.length > 0 && <div className="adsets-scroll"><div className="adsets-table">
            <div className="adset-grid adset-table-head"><span>Адсет / бюджет</span><span>Статус</span><span>Ліди Meta</span><span>Spend</span><span>Ціна / лід</span><span>CPM</span><span>CTR</span><span /></div>
            {rows.map((row) => <div className="adset-grid adset-row" key={row.id}>
                <div className="adset-identity"><strong title={row.name}>{row.name}</strong><small>{row.id} · {row.campaignBudget ? "Бюджет кампанії" : `${money(budgetAmount(row, account.currency), account.currency)}${Number(row.lifetimeBudget) > 0 ? " на весь термін" : " / день"}`}</small><small title={row.optimizationGoal || ""}>Старт: {timestamp(row.startTime)}{row.endTime ? ` · До: ${timestamp(row.endTime)}` : ""}{row.missingFromLatestRead ? " · Збережена копія" : ""}</small></div>
                <span className={`adset-status ${row.effectiveStatus === "ACTIVE" ? "active" : ""}`} title={row.effectiveStatus}>{row.setupIncomplete ? "Потрібна перевірка" : statuses[row.effectiveStatus] || row.effectiveStatus || "Невідомий"}</span>
                <strong>{row.leads ?? "—"}</strong><strong>{money(row.spend, account.currency)}</strong><span>{money(row.costPerLead, account.currency)}</span><span>{money(row.cpm, account.currency)}</span><span>{row.ctr == null ? "—" : `${Number(row.ctr).toFixed(2)}%`}</span>
                <span className="adset-actions">{!removed(row) && <>
                    <button type="button" className="icon-button adset-copy-button" title="Дублювати адсет" aria-label={`Дублювати адсет ${row.name}`} disabled={!canWrite || unavailable(row) || deletingIds.has(String(row.id))} onClick={() => setDuplicate(row)}><Copy size={15} /></button>
                    <button type="button" className="campaign-delete-button" title="Видалити адсет" aria-label={`Видалити адсет ${row.name}`} disabled={!canWrite || row.missingFromLatestRead || deletingIds.has(String(row.id))} onClick={() => deleteRow(row)}>{deletingIds.has(String(row.id)) ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>
                </>}</span>
            </div>)}
        </div></div>}
        {duplicate && <DuplicateAdSetModal row={duplicate} input={input} account={account} onClose={() => setDuplicate(null)} onComplete={async () => applyData(await unwrap(window.adsBot.getCampaignAdSets(input)))} />}
    </section>;
}
