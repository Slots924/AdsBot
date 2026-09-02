import { useState } from "react";
import { motion } from "framer-motion";
import {
    Bot,
    LoaderCircle,
    Pencil,
    Play,
    Plus,
    Power,
    RefreshCw,
    X,
} from "lucide-react";

import { errorDetails } from "../lib/api.js";


function emptyAccountDraft() {
    return { accountKey: "", adsPowerProfileNo: "", userAgent: "", accessToken: "", cookie: "" };
}


function AccountEditor({ editor, onClose, onSave, onError }) {
    const [draft, setDraft] = useState(() => ({
        ...emptyAccountDraft(),
        accountKey: editor.accountKey ?? "",
        adsPowerProfileNo: editor.adsPowerProfileNo ?? "",
    }));
    const [saving, setSaving] = useState(false);
    const update = (field) => (event) => setDraft((current) => ({
        ...current,
        [field]: event.target.value,
    }));
    const creating = editor.mode === "create";
    const canSave = creating
        ? draft.accountKey.trim() && (draft.adsPowerProfileNo.trim() || (
            draft.userAgent.trim() && draft.accessToken.trim() && draft.cookie.trim()
        ))
        : draft.adsPowerProfileNo.trim() || draft.userAgent.trim()
            || draft.accessToken.trim() || draft.cookie.trim();

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
                <span className="eyebrow">Facebook API client</span>
                <h2>{creating ? "Новий акаунт" : `Редагувати ${editor.accountKey}`}</h2>
                {!creating && <p>Порожні поля залишаться без змін. Поточні секрети з міркувань безпеки не показуються.</p>}
                <div className="template-editor-fields">
                    <label className="field"><span>accountKey</span><input autoFocus={creating} readOnly={!creating} value={draft.accountKey} onChange={update("accountKey")} placeholder="fp_hub_2" /></label>
                    <label className="field"><span>AdsPower № (необов'язково)</span><input inputMode="numeric" value={draft.adsPowerProfileNo} onChange={update("adsPowerProfileNo")} placeholder="1791" /><small className="field-hint">З номером AdsPower можна створити клієнт без token, cookie і userAgent — їх додасть синхронізація.</small></label>
                    <label className="field"><span>userAgent</span><textarea rows="3" value={draft.userAgent} onChange={update("userAgent")} placeholder={creating ? "Mozilla/5.0…" : "Залишити без змін"} /></label>
                    <label className="field"><span>accessToken</span><textarea rows="3" value={draft.accessToken} onChange={update("accessToken")} placeholder={creating ? "Access token" : "Залишити без змін"} /></label>
                    <label className="field">
                        <span>Cookie або AdsPower JSON</span>
                        <textarea rows="6" value={draft.cookie} onChange={update("cookie")} placeholder={creating ? "Cookie header або повний JSON-масив cookies" : "Залишити без змін"} />
                        <small className="field-hint">Із масиву автоматично беруться лише потрібні cookies домену facebook.com.</small>
                    </label>
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
    selectedAccountKey,
    loading,
    onSelect,
    onRefresh,
    onCreate,
    onUpdate,
    onDelete,
    onSync = async () => {},
    onOpenProfile = async () => {},
    onCloseProfile = async () => {},
    syncingAccountKeys = [],
    onError,
    standalone = false,
}) {
    const [editor, setEditor] = useState(null);
    const [busyKey, setBusyKey] = useState(null);
    const saveAccount = (draft) => editor.mode === "create"
        ? onCreate(draft)
        : onUpdate(editor.accountKey, draft);

    const removeAccount = async (event, account) => {
        event.stopPropagation();
        if (!window.confirm(
            `Видалити API-клієнта «${account.accountKey}» назавжди?`
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
                <div><span className="eyebrow">Facebook</span><h2>{standalone ? "API-клієнти" : "Акаунти"}</h2></div>
                <div className="sidebar-account-tools">
                    {!standalone && <button className="icon-button" onClick={() => setEditor({ mode: "create" })} title="Додати акаунт"><Plus size={17} /></button>}
                    <button className="icon-button" onClick={onRefresh} disabled={loading} title="Оновити акаунти"><RefreshCw className={loading ? "spin" : ""} size={17} /></button>
                </div>
            </div>
            <div className="account-list">
                {loading && accounts.length === 0
                    ? [1, 2, 3].map((item) => <div className="account-card skeleton" key={item} />)
                    : accounts.map((account, index) => (
                        <motion.div className={`account-card-shell ${account.archived ? "archived" : ""}`} key={account.accountKey} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .045 }}>
                            <button type="button" className={`account-card ${account.accountKey === selectedAccountKey ? "selected" : ""}`} onClick={() => !account.archived && onSelect(account.accountKey)} disabled={account.archived}>
                                <span className={`status-dot ${account.status}`} />
                                <span className="account-copy">
                                    <strong>{account.accountKey}</strong>
                                    <span>{account.archived ? "В архіві" : account.name || "Без імені"}</span>
                                    <small>{account.facebookUserId || "ID не вказано"}</small>
                                    {account.adsPowerProfileNo && <small>AdsPower № {account.adsPowerProfileNo}</small>}
                                    <small>
                                        Дані: UA {account.hasUserAgent ? "є" : "—"}
                                        {" · "}token {account.hasAccessToken ? "є" : "—"}
                                        {" · "}cookie {account.hasCookie ? "є" : "—"}
                                    </small>
                                    {account.error?.message && <em>{account.error.message}</em>}
                                </span>
                            </button>
                            <span className="account-card-tools">
                                {(() => {
                                    const syncing = syncingAccountKeys.includes(account.accountKey);
                                    const unavailable = !account.adsPowerProfileNo;
                                    return <button type="button" className="icon-button" title={unavailable ? "Додайте номер профілю AdsPower" : "Синхронізувати з AdsPower"} disabled={busyKey === account.accountKey || syncing || account.archived || unavailable} onClick={(event) => sync(event, account)}>{busyKey === account.accountKey || syncing ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}</button>;
                                })()}
                                {account.adsPowerProfileNo && (account.adsPowerOpen ? <button type="button" className="icon-button danger" title="Профіль відкритий — закрити" disabled={busyKey === account.accountKey || account.archived} onClick={(event) => changeProfileState(event, account, onCloseProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />}</button> : <button type="button" className="icon-button" title="Відкрити AdsPower-профіль" disabled={busyKey === account.accountKey || account.archived} onClick={(event) => changeProfileState(event, account, onOpenProfile)}>{busyKey === account.accountKey ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}</button>)}
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
                    onClick={() => setEditor({ mode: "create" })}
                >
                    <Plus size={18} />
                    <span>Додати API-клієнта</span>
                </button>
            )}
            {!standalone && (
                <div className="sidebar-legend">
                    <span><i className="status-dot active" /> Активний</span>
                    <span><i className="status-dot inactive" /> Неактивний</span>
                    <span><i className="status-dot error" /> Помилка перевірки</span>
                </div>
            )}
            {editor && <AccountEditor editor={editor} onClose={() => setEditor(null)} onSave={saveAccount} onError={onError} />}
        </aside>
    );
}
