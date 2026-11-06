import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
    Bot,
    Eye,
    EyeOff,
    CloudDownload,
    KeyRound,
    LoaderCircle,
    Pencil,
    Play,
    Plus,
    Power,
    RefreshCw,
    RotateCw,
    Star,
    Trash2,
    UserRoundCog,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import { defaultAfpUserAgent, getAccountTokenMode } from "../../../facebook/api/accountCredentials.js";
import { UiSelect } from "./shared-ui/SharedUi.jsx";
import { getAccountProxyMode } from "../../../services/proxy/accountProxyMode.js";

const kinds = [
    { id: "api", label: "API-клієнти" },
    { id: "bm", label: "BM" },
    { id: "system", label: "System Users" },
];
import { systemUserAgents } from "../lib/systemUserAgents.js";

function KindPicker({ value, onChange, disabled = false }) {
    return <div className="account-kind-picker" role="radiogroup" aria-label="Тип клієнта">
        {kinds.map((kind) => <label key={kind.id} className={`account-kind-option ${kind.id} ${value === kind.id ? "active" : ""}`}>
            <input type="radio" name="account-kind" checked={value === kind.id} disabled={disabled} onChange={() => onChange(kind.id)} />
            <span>{kind.label}</span>
        </label>)}
    </div>;
}

function ProxyPicker({ proxies, value, onChange }) {
    return <UiSelect items={proxies.map((proxy) => ({
        id: proxy.id,
        name: `${proxy.name || "Без назви"} · ${proxy.adsPowerId ?? proxy.id}`,
    }))} value={value} onChange={onChange} ariaLabel="Прив’язана проксі"
        placeholder="Оберіть проксі" searchPlaceholder="Пошук проксі…"
        emptyText="Немає доступних проксі." portal />;
}


function emptyAccountDraft() {
    return { kind: "api", name: "", adsPowerProfileNo: "", userAgent: "", accessToken: "", cookie: "", afpToken: "", afpUserAgent: defaultAfpUserAgent, tokenMode: "access", proxyId: "", proxyMode: "profile" };
}

function SecretField({ label, value, onChange, placeholder }) {
    const [visible, setVisible] = useState(false);
    return <label className="field"><span>{label}</span><div className="account-secret-input">
        <input type={visible ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} autoComplete="off" spellCheck={false} />
        <button type="button" className="icon-button" aria-label={`${visible ? "Приховати" : "Показати"} ${label}`} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div></label>;
}

function TokenPicker({ value, onChange, disabled = false, afpDisabled = false, label = "Токен для запитів" }) {
    return <div className="account-token-picker" role="group" aria-label={label}>
        {[["access", "Access token"], ["afp", "AFP token"]].map(([id, title]) => <button key={id} type="button" aria-pressed={value === id} disabled={disabled || (id === "afp" && afpDisabled)} title={id === "afp" && afpDisabled ? "Спочатку додайте AFP token у редакторі" : undefined} onClick={() => onChange(id)}>{title}</button>)}
    </div>;
}

function AccountEditor({ editor, proxies, onClose, onSave, onError }) {
    const [draft, setDraft] = useState(() => ({
        ...emptyAccountDraft(),
        ...editor.credentials,
        afpUserAgent: editor.credentials?.afpUserAgent || defaultAfpUserAgent,
        tokenMode: getAccountTokenMode(editor),
        name: editor.name ?? "",
        adsPowerProfileNo: editor.adsPowerProfileNo ?? "",
        kind: editor.kind ?? "api",
        proxyId: editor.proxyId ?? "",
        proxyMode: editor.mode === "create" ? (editor.kind === "system" ? "auto" : "profile") : getAccountProxyMode(editor),
    }));
    const [saving, setSaving] = useState(false);
    const [tokenTab, setTokenTab] = useState(getAccountTokenMode(editor));
    const update = (field) => (event) => setDraft((current) => ({
        ...current,
        [field]: event.target.value,
    }));
    const creating = editor.mode === "create";
    const system = draft.kind === "system";
    const canSave = (draft.proxyMode !== "bound" || proxies.some((proxy) => proxy.id === draft.proxyId && proxy.type !== "no_proxy")) && (creating
        ? draft.name.trim() && (draft.kind === "api" || (system ? draft.userAgent.trim() && draft.accessToken.trim() : draft.adsPowerProfileNo.trim() || (
            draft.userAgent.trim() && draft.accessToken.trim()
        )))
        : draft.name.trim());

    const submit = async (event) => {
        event.preventDefault();
        if (!canSave || saving) return;
        setSaving(true);
        try {
            await onSave(creating ? draft : { ...draft, replaceCredentials: true });
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

    return createPortal(
        <div className="overlay" onMouseDown={() => !saving && onClose()}>
            <motion.form role="dialog" aria-modal="true" aria-label={creating ? "Новий клієнт" : "Редагувати клієнта"} className="modal account-editor connection-editor" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape" && !saving) onClose(); }} onSubmit={submit}>
                <button className="modal-close" type="button" aria-label="Закрити редактор" disabled={saving} onClick={onClose}><X size={17} /></button>
                <h2>{creating ? "Новий клієнт" : "Редагувати клієнта"}</h2>
                <p className="connection-editor-description">Профіль, доступ до Facebook і налаштування з’єднання.</p>
                <KindPicker value={draft.kind} disabled={!creating} onChange={(kind) => setDraft((current) => ({ ...current, kind, userAgent: "", proxyMode: current.proxyMode === "bound" ? "bound" : kind === "system" ? "auto" : "profile" }))} />
                <div className="template-editor-fields">
                    <label className="field"><span>{system ? "Назва системного юзера" : draft.kind === "bm" ? "Назва BM" : "Назва API-клієнта"}</span><input autoFocus value={draft.name} onChange={update("name")} placeholder="Наприклад, Польща 1" /></label>
                    {draft.kind === "api" && <TokenPicker label="Налаштування токенів" value={tokenTab} onChange={setTokenTab} />}
                    {draft.kind === "api" && tokenTab === "afp" ? <>
                        <SecretField label="AFP token" value={draft.afpToken} onChange={update("afpToken")} placeholder="Необов’язково" />
                        <label className="field"><span>AFP User-Agent</span><select value={draft.afpUserAgent} onChange={update("afpUserAgent")}>
                            {!systemUserAgents.some(([, value]) => value === draft.afpUserAgent) && <option value={draft.afpUserAgent}>{draft.afpUserAgent}</option>}
                            {systemUserAgents.map(([label, value]) => <option key={label} value={value}>{label}</option>)}
                        </select></label>
                        <small className="field-hint">Без cookie · проксі зі вкладки Access token.</small>
                    </> : <>
                        {!system && <label className="field"><span>AdsPower № (необов'язково)</span><input inputMode="numeric" value={draft.adsPowerProfileNo} onChange={update("adsPowerProfileNo")} placeholder="1791" /></label>}
                        {system ? <label className="field"><span>User-Agent</span><select value={draft.userAgent} onChange={update("userAgent")}><option value="">Виберіть User-Agent</option>{draft.userAgent && !systemUserAgents.some(([, value]) => value === draft.userAgent) && <option value={draft.userAgent}>{draft.userAgent}</option>}{systemUserAgents.map(([label, value]) => <option key={label} value={value}>{label}</option>)}</select></label> : <label className="field"><span>userAgent</span><input value={draft.userAgent} onChange={update("userAgent")} placeholder="Mozilla/5.0…" /></label>}
                        <SecretField label="accessToken" value={draft.accessToken} onChange={update("accessToken")} placeholder="Access token" />
                        {!system && <SecretField label="Cookie або AdsPower JSON" value={draft.cookie} onChange={update("cookie")} placeholder="Необов’язково" />}
                    <div className="account-proxy-binding">
                        <span className="account-proxy-label">Проксі</span>
                        <div className="account-proxy-modes" role="radiogroup" aria-label="Режим проксі">
                            {[...(!system ? [{ id: "profile", label: "Профіль", aria: "Проксі профілю" }] : []), { id: "auto", label: "Авто", aria: "Автоматично" }, { id: "bound", label: "Призначити", aria: "Прив’язати проксі" }].map((mode) => <label key={mode.id} className={draft.proxyMode === mode.id ? "active" : ""}>
                                <input type="radio" aria-label={mode.aria} name="account-proxy-mode" value={mode.id} checked={draft.proxyMode === mode.id} disabled={saving} onChange={() => setDraft((current) => ({ ...current, proxyMode: mode.id, proxyId: mode.id === "bound" ? current.proxyId : "" }))} />
                                <span>{mode.label}</span>
                            </label>)}
                        </div>
                        <small className="field-hint">{draft.proxyMode === "profile" ? "Браузер і API-запити використовують проксі AdsPower-профілю." : draft.proxyMode === "auto" ? "Автоматично вибираємо робочу загальнодоступну проксі." : "Використовуємо лише вибрану проксі."}</small>
                        {draft.proxyMode === "profile" && <small className="field-hint">{editor.hasAdsPowerProxy && String(draft.adsPowerProfileNo).trim() === String(editor.adsPowerProfileNo).trim()
                            ? `Проксі отримана · оновлено ${new Date(editor.adsPowerProxyUpdatedAt).toLocaleString("uk-UA")}`
                            : "Проксі буде отримана перед першим запитом"}</small>}
                        {draft.proxyMode === "bound" && <div className="field"><span>Прив’язана проксі</span><ProxyPicker proxies={proxies.filter((proxy) => proxy.type !== "no_proxy")} value={draft.proxyId} onChange={(proxyId) => setDraft((current) => ({ ...current, proxyId }))} /></div>}
                    </div>
                    </>}
                </div>
                <div className="form-actions">
                    <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Скасувати</button>
                    <button className="primary-button" type="submit" disabled={!canSave || saving}>{saving && <LoaderCircle className="spin" size={16} />}{creating ? "Створити" : "Зберегти зміни"}</button>
                </div>
            </motion.form>
        </div>, document.body
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
    onRefreshAccessToken = async () => {},
    onOpenProfile = async () => {},
    onCloseProfile = async () => {},
    syncingAccountKeys = [],
    refreshingTokenAccountKeys = [],
    onError,
    standalone = false,
}) {
    const [kind, setKind] = useState("api");
    const [editor, setEditor] = useState(null);
    const [busyKey, setBusyKey] = useState(null);
    const [editingKey, setEditingKey] = useState(null);
    const visibleAccounts = accounts.filter((account) => (account.kind || "api") === kind);
    const saveAccount = (draft) => editor.mode === "create"
        ? onCreate(draft)
        : onUpdate(editor.accountKey, draft);

    const openEditor = async (account) => {
        setEditingKey(account.accountKey);
        try {
            const credentials = await unwrap(window.adsBot.getAccountEditorCredentials(account.accountKey));
            setEditor({ mode: "edit", ...account, credentials });
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося відкрити клієнта" });
        } finally {
            setEditingKey(null);
        }
    };

    const changeTokenMode = async (account, tokenMode) => {
        if (tokenMode === "afp" && !account.hasAfpToken) return;
        if (getAccountTokenMode(account) === tokenMode) return;
        setBusyKey(account.accountKey);
        try {
            await onUpdate(account.accountKey, { tokenMode });
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося перемкнути токен" });
        } finally {
            setBusyKey(null);
        }
    };

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
    const refreshAccessToken = async (event, account) => {
        event.stopPropagation();
        setBusyKey(account.accountKey);
        try {
            await onRefreshAccessToken(account.accountKey);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося оновити access token" });
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
                <div className="connection-panel-title">{!standalone && <span className="eyebrow">Facebook</span>}<h2>API-клієнти</h2>{standalone && <b className="strip-count">{visibleAccounts.length}</b>}</div>
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
                        <motion.div className={`account-card-shell connection-card kind-${account.kind || "api"} ${account.archived ? "archived" : ""} ${account.accountKey === selectedAccountKey ? "selected" : ""}`} key={account.accountKey} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .045 }} onClick={(event) => {
                            if (account.archived || account.kind === "system") return;
                            const button = event.target.closest("button");
                            if (button && !button.classList.contains("account-card")) return;
                            onSelect(account.accountKey);
                        }}>
                            <button type="button" className={`account-card ${account.accountKey === selectedAccountKey ? "selected" : ""}`} aria-pressed={account.accountKey === selectedAccountKey} disabled={account.archived || account.kind === "system"}>
                                <span className={`status-dot ${account.status}`} />
                                <span className="account-copy">
                                    <span className="connection-title-row"><strong title={account.name}>{account.name || "Без назви"}</strong><span className={`connection-status ${account.archived ? "archived" : account.status || "unknown"}`}>{account.archived ? "В архіві" : account.isPrimary ? "Основний" : ({ active: "Активний", inactive: "Неактивний", error: "Помилка" })[account.status] || "Не перевірено"}</span></span>
                                    {standalone ? <span className="connection-facts">
                                        <span><span className="connection-fact-label">Профіль AdsPower</span><span className="connection-fact-value">{account.adsPowerProfileNo ? `№ ${account.adsPowerProfileNo}` : "Не прив’язано"}</span></span>
                                        <span><span className="connection-fact-label">{account.facebookUserId ? "Facebook ID" : "Ключ клієнта"}</span><span className="connection-fact-value connection-facebook-id">{account.facebookUserId || account.accountKey}</span></span>
                                    </span> : <small className="connection-meta" title={account.proxyId ? `Проксі: ${proxies.find((proxy) => proxy.id === account.proxyId)?.name || account.proxyId}` : undefined}>
                                        {account.facebookUserId || account.accountKey}<span className="connection-meta-divider">·</span>{account.adsPowerProfileNo ? `AdsPower № ${account.adsPowerProfileNo}` : "Без AdsPower-профілю"}
                                    </small>}
                                    {account.error?.message ? <em className="connection-detail" title={account.error.message}>{account.error.message}</em> : <small className="connection-detail">
                                        {getAccountTokenMode(account) === "afp" ? `AFP token ${account.hasAfpToken ? "є" : "—"} · без cookie` : <>UA {account.hasUserAgent ? "✓" : "—"} · token {account.hasAccessToken ? "✓" : "—"}{account.kind !== "system" && <> · cookie {account.hasCookie ? "✓" : "—"}</>}</>}
                                    </small>}
                                </span>
                            </button>
                            {getAccountTokenMode(account) === "afp" && <small className="connection-detail" role="status" title={account.spendServer?.message || (account.spendServer?.sentAt ? `???????????: ${new Date(account.spendServer.sentAt).toLocaleString()}` : "????? ???????? ????????? ?????? ???? ???? ??????????? ?? ??????")}>
                                <span style={{ color: account.spendServer?.state === "success" ? "#22c55e" : account.spendServer?.state === "error" ? "#ef4444" : "#94a3b8" }}>?</span> Spend Server: {account.spendServer?.state === "success" ? "???????????" : account.spendServer?.state === "error" ? "??????? ?????????" : "?? ???????????"}
                            </small>}
                            <div className="connection-card-footer">
                            {(account.kind || "api") === "api" ? <div className="account-card-token-mode"><TokenPicker value={getAccountTokenMode(account)} onChange={(mode) => changeTokenMode(account, mode)} afpDisabled={!account.hasAfpToken} disabled={busyKey === account.accountKey || syncingAccountKeys.includes(account.accountKey) || refreshingTokenAccountKeys.includes(account.accountKey) || account.archived} /></div> : <span className="connection-kind-label">{account.kind === "bm" ? "Business Manager" : "System User"}</span>}
                            <span className="account-card-tools">
                            {account.kind !== "system" && <button
                                type="button"
                                className="icon-button account-card-check"
                                title="Перевірити, чи працює API-клієнт"
                                disabled={busyKey === account.accountKey || account.archived}
                                onClick={(event) => check(event, account)}
                            >
                                {busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <RotateCw size={13} />}
                            </button>}
                                {account.kind === "bm" && <button type="button" className="icon-button account-personal-button" title="Відкрити персональний акаунт із цим БМ" aria-label={`Персональний акаунт для ${account.name || "БМ"}`} disabled={account.archived} onClick={(event) => { event.stopPropagation(); onOpenPersonalAccount(account); }}><UserRoundCog size={14} /></button>}
                                {(account.kind === "bm" || account.kind === "system") && <button type="button" className={`icon-button account-primary-button ${account.isPrimary ? "active" : ""}`} title={account.isPrimary ? "Основний клієнт" : "Зробити основним"} aria-label={account.isPrimary ? "Основний клієнт" : "Зробити основним"} disabled={account.isPrimary || busyKey === account.accountKey} onClick={(event) => { event.stopPropagation(); setBusyKey(account.accountKey); Promise.resolve(onSetPrimary(account.accountKey)).catch((error) => onError({ ...errorDetails(error), title: "Не вдалося обрати основного клієнта" })).finally(() => setBusyKey(null)); }}><Star size={14} fill={account.isPrimary ? "currentColor" : "none"} /></button>}
                                {account.kind !== "system" && (() => {
                                    const syncing = syncingAccountKeys.includes(account.accountKey);
                                    const refreshing = refreshingTokenAccountKeys.includes(account.accountKey);
                                    const unavailable = !account.adsPowerProfileNo;
                                    const disabled = busyKey === account.accountKey || syncing || refreshing || account.archived || getAccountTokenMode(account) === "afp";
                                    return <span className="account-sync-actions">
                                        <button type="button" className="icon-button" title={unavailable ? "Додайте номер профілю AdsPower" : "Синхронізувати з AdsPower"} disabled={disabled || unavailable} onClick={(event) => sync(event, account)}>{syncing ? <LoaderCircle className="spin" size={13} /> : <CloudDownload size={13} />}</button>
                                        <button type="button" className="icon-button" aria-label="Оновити access token" title={!account.hasCookie || !account.hasUserAgent ? "Спочатку додайте cookies та User-Agent або синхронізуйте з AdsPower" : "Оновити access token через проксі"} disabled={disabled || !account.hasCookie || !account.hasUserAgent} onClick={(event) => refreshAccessToken(event, account)}>{refreshing ? <LoaderCircle className="spin" size={13} /> : <KeyRound size={13} />}</button>
                                    </span>;
                                })()}
                                {account.kind !== "system" && (account.adsPowerOpen ? <button type="button" className="icon-button danger" title="Профіль відкритий — закрити" disabled={busyKey === account.accountKey || account.archived || !account.adsPowerProfileNo} onClick={(event) => changeProfileState(event, account, onCloseProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}</button> : <button type="button" className="icon-button account-launch-button" aria-label="Відкрити AdsPower-профіль" title={account.adsPowerProfileNo ? "Відкрити AdsPower-профіль" : "Спочатку вкажіть AdsPower-профіль"} disabled={busyKey === account.accountKey || account.archived || !account.adsPowerProfileNo} onClick={(event) => changeProfileState(event, account, onOpenProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}</button>)}
                                <button type="button" className="icon-button" title="Редагувати" disabled={editingKey !== null || busyKey === account.accountKey} onClick={(event) => { event.stopPropagation(); openEditor(account); }}>{editingKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Pencil size={13} />}</button>
                                <button type="button" className="icon-button danger account-delete-button" title="Видалити API-клієнта" disabled={busyKey === account.accountKey} onClick={(event) => removeAccount(event, account)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button>
                            </span>
                            </div>
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
            {editor && <AccountEditor editor={{ ...editor, ...(editor.mode === "edit" ? accounts.find((account) => account.accountKey === editor.accountKey) : {}) }} proxies={proxies} onClose={() => setEditor(null)} onSave={saveAccount} onError={onError} />}
        </aside>
    );
}
