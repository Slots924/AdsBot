import { useState } from "react";
import { motion } from "framer-motion";
import {
    Bot,
    CloudDownload,
    LoaderCircle,
    Pencil,
    Play,
    Plus,
    Power,
    RefreshCw,
    RotateCw,
    Star,
    UserRoundCog,
    X,
} from "lucide-react";

import { errorDetails } from "../lib/api.js";

const kinds = [
    { id: "api", label: "API-клієнти" },
    { id: "bm", label: "BM" },
    { id: "system", label: "System Users" },
];
const systemUserAgents = [153, 154].flatMap((version) => [
    [`Chrome ${version} · Windows`, `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`],
    [`Chrome ${version} · macOS`, `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`],
    [`Chrome ${version} · Linux`, `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`],
    [`Chrome ${version} · Android`, `Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Mobile Safari/537.36`],
    [`Edge ${version} · Windows`, `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36 Edg/${version}.0.0.0`],
]);

function KindPicker({ value, onChange, disabled = false }) {
    return <div className="account-kind-picker" role="radiogroup" aria-label="Тип клієнта">
        {kinds.map((kind) => <label key={kind.id} className={`account-kind-option ${kind.id} ${value === kind.id ? "active" : ""}`}>
            <input type="radio" name="account-kind" checked={value === kind.id} disabled={disabled} onChange={() => onChange(kind.id)} />
            <span>{kind.label}</span>
        </label>)}
    </div>;
}

function ProxyPicker({ proxies, value, onChange }) {
    const [open, setOpen] = useState(false);
    const selected = proxies.find((proxy) => proxy.id === value);
    return <div className="account-proxy-picker">
        <button type="button" className="account-proxy-choice" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            <strong>{selected?.name || " "}</strong><small>{selected?.id || "Оберіть проксі"}</small>
        </button>
        {open && <div className="account-proxy-options" role="listbox" aria-label="Проксі">
            {proxies.map((proxy) => <button type="button" role="option" aria-selected={proxy.id === value} key={proxy.id} onClick={() => { onChange(proxy.id); setOpen(false); }}><strong>{proxy.name || " "}</strong><small>{proxy.id}</small></button>)}
        </div>}
    </div>;
}


function emptyAccountDraft() {
    return { kind: "api", name: "", adsPowerProfileNo: "", userAgent: "", accessToken: "", cookie: "", proxyId: "" };
}


function AccountEditor({ editor, proxies, onClose, onSave, onError }) {
    const [draft, setDraft] = useState(() => ({
        ...emptyAccountDraft(),
        name: editor.name ?? "",
        adsPowerProfileNo: editor.adsPowerProfileNo ?? "",
        kind: editor.kind ?? "api",
        proxyId: editor.proxyId ?? "",
    }));
    const [saving, setSaving] = useState(false);
    const update = (field) => (event) => setDraft((current) => ({
        ...current,
        [field]: event.target.value,
    }));
    const creating = editor.mode === "create";
    const system = draft.kind === "system";
    const canSave = creating
        ? draft.name.trim() && (system ? draft.userAgent.trim() && draft.accessToken.trim() : draft.adsPowerProfileNo.trim() || (
            draft.userAgent.trim() && draft.accessToken.trim() && draft.cookie.trim()
        ))
        : draft.name.trim();

    const submit = async (event) => {
        event.preventDefault();
        if (!canSave || saving) return;
        setSaving(true);
        try {
            await onSave(draft);
            onClose();
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: creating
                    ? "Не вдалося створити акаунт"
                    : "Не вдалося оновити акаунт",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overlay" onMouseDown={() => !saving && onClose()}>
            <motion.form className="modal account-editor" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
                <button className="modal-close" type="button" disabled={saving} onClick={onClose}><X size={17} /></button>
                <div className="modal-icon"><Bot /></div>
                <h2>{creating ? "Новий клієнт" : "Редагувати клієнта"}</h2>
                <KindPicker value={draft.kind} disabled={!creating} onChange={(kind) => setDraft((current) => ({ ...current, kind, userAgent: "" }))} />
                {!creating && <p>Порожні поля залишаться без змін. Поточні секрети з міркувань безпеки не показуються.</p>}
                <div className="template-editor-fields">
                    <label className="field"><span>{system ? "Назва системного юзера" : draft.kind === "bm" ? "Назва BM" : "Назва API-клієнта"}</span><input autoFocus value={draft.name} onChange={update("name")} placeholder="Наприклад, Польща 1" /></label>
                    {!system && <label className="field"><span>AdsPower № (необов'язково)</span><input inputMode="numeric" value={draft.adsPowerProfileNo} onChange={update("adsPowerProfileNo")} placeholder="1791" /><small className="field-hint">З номером AdsPower можна створити клієнт без token, cookie і userAgent — їх додасть синхронізація.</small></label>}
                    {system ? <label className="field"><span>User-Agent</span><select value={draft.userAgent} onChange={update("userAgent")}><option value="">Виберіть User-Agent</option>{systemUserAgents.map(([label, value]) => <option key={label} value={value}>{label}</option>)}</select></label> : <label className="field"><span>userAgent</span><textarea rows="3" value={draft.userAgent} onChange={update("userAgent")} placeholder={creating ? "Mozilla/5.0…" : "Залишити без змін"} /></label>}
                    <label className="field"><span>accessToken</span><textarea rows="3" value={draft.accessToken} onChange={update("accessToken")} placeholder={creating ? "Access token" : "Залишити без змін"} /></label>
                    {!system && <label className="field">
                        <span>Cookie або AdsPower JSON</span>
                        <textarea rows="6" value={draft.cookie} onChange={update("cookie")} placeholder={creating ? "Cookie header або повний JSON-масив cookies" : "Залишити без змін"} />
                        <small className="field-hint">Із масиву автоматично беруться лише потрібні cookies домену facebook.com.</small>
                    </label>}
                    <div className="account-proxy-binding">
                        <label className="checkbox-line"><input type="checkbox" disabled={!proxies.some((proxy) => proxy.type !== "no_proxy")} checked={Boolean(draft.proxyId)} onChange={(event) => setDraft((current) => ({ ...current, proxyId: event.target.checked ? proxies.find((proxy) => proxy.type !== "no_proxy")?.id || "" : "" }))} />Прив’язати проксі</label>
                        {draft.proxyId && <div className="field"><span>Використовувати лише цю проксі</span><ProxyPicker proxies={proxies.filter((proxy) => proxy.type !== "no_proxy")} value={draft.proxyId} onChange={(proxyId) => setDraft((current) => ({ ...current, proxyId }))} /></div>}
                    </div>
                </div>
                <div className="form-actions">
                    <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Скасувати</button>
                    <button className="primary-button" type="submit" disabled={!canSave || saving}>{saving && <LoaderCircle className="spin" size={16} />}{creating ? "Створити" : "Зберегти зміни"}</button>
                </div>
            </motion.form>
        </div>
    );
}


export default function Sidebar({
    accounts,
    proxies = [],
    selectedAccountKey,
    loading,
    onSelect,
    onRefresh,
    onCreate,
    onUpdate,
    onDelete,
    onCheck = async () => {},
    onSetPrimary = async () => {},
    onOpenPersonalAccount = () => {},
    onSync = async () => {},
    onOpenProfile = async () => {},
    onCloseProfile = async () => {},
    syncingAccountKeys = [],
    onError,
    standalone = false,
}) {
    const [kind, setKind] = useState("api");
    const [editor, setEditor] = useState(null);
    const [busyKey, setBusyKey] = useState(null);
    const visibleAccounts = accounts.filter((account) => (account.kind || "api") === kind);
    const saveAccount = (draft) => editor.mode === "create"
        ? onCreate(draft)
        : onUpdate(editor.accountKey, draft);

    const removeAccount = async (event, account) => {
        event.stopPropagation();
        if (!window.confirm(
            `Видалити API-клієнта «${account.name || "Без назви"}» назавжди?`
        )) return;
        setBusyKey(account.accountKey);
        try {
            await onDelete(account.accountKey);
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося видалити API-клієнта",
            });
        } finally {
            setBusyKey(null);
        }
    };
    const sync = async (event, account) => {
        event.stopPropagation();
        setBusyKey(account.accountKey);
        try {
            await onSync(account.accountKey);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося додати синхронізацію в чергу" });
        } finally {
            setBusyKey(null);
        }
    };
    const check = async (event, account) => {
        event.stopPropagation();
        setBusyKey(account.accountKey);
        try {
            await onCheck(account.accountKey);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося перевірити API-клієнт" });
        } finally {
            setBusyKey(null);
        }
    };
    const changeProfileState = async (event, account, action) => {
        event.stopPropagation();
        setBusyKey(account.accountKey);
        try {
            await action(account.accountKey);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося змінити стан AdsPower-профілю" });
        } finally {
            setBusyKey(null);
        }
    };

    return (
        <aside className={`sidebar ${standalone ? "accounts-tab-sidebar resource-strip" : ""}`}>
            {!standalone && <div className="brand"><div className="brand-mark"><Bot size={22} /></div><div><strong>AdsBot</strong><span>Control center</span></div></div>}
            <div className="sidebar-title-row">
                <div><span className="eyebrow">Facebook</span><h2>API-клієнти</h2></div>
                <div className="sidebar-account-tools">
                    {!standalone && <button className="icon-button" onClick={() => setEditor({ mode: "create", kind })} title="Додати акаунт"><Plus size={17} /></button>}
                    <button className="icon-button" onClick={onRefresh} disabled={loading} title="Оновити акаунти"><RefreshCw className={loading ? "spin" : ""} size={17} /></button>
                </div>
            </div>
            <KindPicker value={kind} onChange={setKind} />
            <div className="account-list">
                {!loading && visibleAccounts.length === 0 && <div className="account-empty-state">У цій категорії ще немає клієнтів.</div>}
                {loading && accounts.length === 0
                    ? [1, 2, 3].map((item) => <div className="account-card skeleton" key={item} />)
                    : visibleAccounts.map((account, index) => (
                        <motion.div className={`account-card-shell kind-${account.kind || "api"} ${account.archived ? "archived" : ""}`} key={account.accountKey} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .045 }}>
                            <button type="button" className={`account-card ${account.accountKey === selectedAccountKey ? "selected" : ""}`} onClick={() => account.kind !== "system" && !account.archived && onSelect(account.accountKey)} disabled={account.archived}>
                                <span className={`status-dot ${account.status}`} />
                                <span className="account-copy">
                                    <strong>{account.name || "Без назви"}</strong>
                                    {(account.kind === "bm" || account.kind === "system") && account.isPrimary && <small className="account-primary-label">Основний</small>}
                                    <span>{account.archived ? "В архіві" : account.kind === "system" ? "System User" : account.kind === "bm" ? "BM" : "API-клієнт"}</span>
                                    <small>{account.facebookUserId || account.accountKey}</small>
                                    {account.adsPowerProfileNo && <small>AdsPower № {account.adsPowerProfileNo}</small>}
                                    <small>
                                        Дані: UA {account.hasUserAgent ? "є" : "—"}
                                        {" · "}token {account.hasAccessToken ? "є" : "—"}
                                        {account.kind !== "system" && <> · cookie {account.hasCookie ? "є" : "—"}</>}
                                    </small>
                                    {account.proxyId && <small>Проксі: {proxies.find((proxy) => proxy.id === account.proxyId)?.name || " "} · {account.proxyId}</small>}
                                    {account.error?.message && <em>{account.error.message}</em>}
                                </span>
                            </button>
                            {account.kind !== "system" && <button
                                type="button"
                                className="icon-button account-card-check"
                                title="Перевірити, чи працює API-клієнт"
                                disabled={busyKey === account.accountKey || account.archived}
                                onClick={(event) => check(event, account)}
                            >
                                {busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <RotateCw size={13} />}
                            </button>}
                            <span className="account-card-tools">
                                {account.kind === "bm" && <button type="button" className="icon-button account-personal-button" title="Відкрити персональний акаунт із цим БМ" aria-label={`Персональний акаунт для ${account.name || "БМ"}`} disabled={account.archived} onClick={(event) => { event.stopPropagation(); onOpenPersonalAccount(account); }}><UserRoundCog size={14} /></button>}
                                {(account.kind === "bm" || account.kind === "system") && <button type="button" className={`icon-button account-primary-button ${account.isPrimary ? "active" : ""}`} title={account.isPrimary ? "Основний клієнт" : "Зробити основним"} aria-label={account.isPrimary ? "Основний клієнт" : "Зробити основним"} disabled={account.isPrimary || busyKey === account.accountKey} onClick={(event) => { event.stopPropagation(); setBusyKey(account.accountKey); Promise.resolve(onSetPrimary(account.accountKey)).catch((error) => onError({ ...errorDetails(error), title: "Не вдалося обрати основного клієнта" })).finally(() => setBusyKey(null)); }}><Star size={14} fill={account.isPrimary ? "currentColor" : "none"} /></button>}
                                {account.kind !== "system" && (() => {
                                    const syncing = syncingAccountKeys.includes(account.accountKey);
                                    const unavailable = !account.adsPowerProfileNo;
                                    return <button type="button" className="icon-button" title={unavailable ? "Додайте номер профілю AdsPower" : "Синхронізувати з AdsPower"} disabled={busyKey === account.accountKey || syncing || account.archived || unavailable} onClick={(event) => sync(event, account)}>{busyKey === account.accountKey || syncing ? <LoaderCircle className="spin" size={13} /> : <CloudDownload size={13} />}</button>;
                                })()}
                                {account.kind !== "system" && account.adsPowerProfileNo && (account.adsPowerOpen ? <button type="button" className="icon-button danger" title="Профіль відкритий — закрити" disabled={busyKey === account.accountKey || account.archived} onClick={(event) => changeProfileState(event, account, onCloseProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}</button> : <button type="button" className="icon-button" title="Відкрити AdsPower-профіль" disabled={busyKey === account.accountKey || account.archived} onClick={(event) => changeProfileState(event, account, onOpenProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}</button>)}
                                <button type="button" className="icon-button" title="Редагувати" onClick={(event) => { event.stopPropagation(); setEditor({ mode: "edit", ...account }); }}><Pencil size={13} /></button>
                                <button type="button" className="icon-button danger" title="Видалити API-клієнта" disabled={busyKey === account.accountKey} onClick={(event) => removeAccount(event, account)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}</button>
                            </span>
                        </motion.div>
                    ))}
            </div>
            {standalone && (
                <button
                    type="button"
                    className="strip-add-button"
                    title="Додати акаунт"
                    onClick={() => setEditor({ mode: "create", kind })}
                >
                    <Plus size={18} />
                    <span>{kind === "api" ? "Додати API-клієнта" : kind === "bm" ? "Додати BM" : "Додати System User"}</span>
                </button>
            )}
            {!standalone && (
                <div className="sidebar-legend">
                    <span><i className="status-dot active" /> Активний</span>
                    <span><i className="status-dot inactive" /> Неактивний</span>
                    <span><i className="status-dot error" /> Помилка перевірки</span>
                </div>
            )}
            {editor && <AccountEditor editor={editor} proxies={proxies} onClose={() => setEditor(null)} onSave={saveAccount} onError={onError} />}
        </aside>
    );
}
