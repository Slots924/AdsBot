import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, LoaderCircle, Pencil, Play, Power, RefreshCw, Share2, Trash2, UserPlus } from "lucide-react";
import WorkspaceDialog from "../components/WorkspaceDialog.jsx";
import AutouploadFriendRequestModal from "../components/AutouploadFriendRequestModal.jsx";
import AutouploadShareAccountsModal from "../components/AutouploadShareAccountsModal.jsx";
import AutouploadActionDetails from "../components/AutouploadActionDetails.jsx";
import AutouploadTransferModal from "../components/AutouploadTransferModal.jsx";
import { unwrap } from "../lib/api.js";

const statuses = {
    unchecked: ["Не перевірено", "muted"], checking: ["Виконується…", "pending"], active: ["Акаунт активний", "success"],
    login_required: ["Потрібна авторизація", "danger"], checkpoint: ["Потрібне підтвердження", "danger"], error: ["Помилка перевірки", "warning"],
};
const time = (value) => value ? new Date(value).toLocaleString("uk-UA") : "—";

function AccountLed({ tone, label, title = label }) {
    return <span role="img" aria-label={label} title={title} className={`autoupload-led ${tone}`} />;
}

function ProfileAssets({ profile, type }) {
    const assets = profile.assets ?? {};
    const items = assets[type] ?? [];
    if (!items.length) return <span className="autoupload-asset-empty">{assets[`${type}State`] === "loaded" ? "Немає доступних" : assets[`${type}State`] === "error" ? "Помилка завантаження" : "Не перевірено"}</span>;
    return <div className="autoupload-assets">{items.map((item) => type === "adAccounts" ? <div className="autoupload-asset" key={item.id} title={`${item.name || "Рекламний кабінет"} · статус Meta: ${item.accountStatus ?? "невідомий"}`}>
        <AccountLed tone={item.accountStatus === 1 ? "success" : [2, 100, 101].includes(item.accountStatus) ? "danger" : "warning"} label={`РК ${item.accountId}: ${item.accountStatus === 1 ? "активний" : [2, 100, 101].includes(item.accountStatus) ? "неактивний" : "потребує уваги"}`} />
        <span className="autoupload-asset-id">{item.accountId}</span>
    </div> : <div className="autoupload-asset autoupload-page" key={item.id} title={`${item.name} · ${item.id}`}><span>{item.name || "Без назви"}</span><small>{item.id}</small></div>)}</div>;
}

export default function AutouploadTab({ showToast }) {
    const [state, setState] = useState({ groups: [], profiles: [], history: [] });
    const [groupId, setGroupId] = useState("all");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState([]);
    const [busy, setBusy] = useState(false);
    const [profileBusy, setProfileBusy] = useState([]);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState(null);
    const [name, setName] = useState("");
    const [target, setTarget] = useState("new");
    const [detail, setDetail] = useState(null);
    const [friendProfiles, setFriendProfiles] = useState(null);
    const [shareProfiles, setShareProfiles] = useState(null);
    const [transferProfiles, setTransferProfiles] = useState(null);
    const [deleteAdsPower, setDeleteAdsPower] = useState(false);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [socialName, setSocialName] = useState({ firstName: "", middleName: "", lastName: "" });
    const actionsRoot = useRef(null);
    useEffect(() => {
        const close = event => { if (event.key === "Escape" || (event.type === "pointerdown" && !actionsRoot.current?.contains(event.target))) setActionsOpen(false); };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
    }, []);
    const revision = useRef(0);
    useEffect(() => {
        let live = true;
        const start = revision.current;
        const off = window.adsBot.onAutouploadUpdated((next) => {
            revision.current += 1;
            if (live) setState(next);
        });
        unwrap(window.adsBot.getAutoupload({ refreshBrowserStates: true })).then((next) => { if (live && revision.current === start) setState(next); }).catch((failure) => { if (live) setError(failure.message); });
        return () => { live = false; off(); };
    }, []);
    const visible = useMemo(() => state.profiles.filter((item) => (groupId === "all" || item.groupId === groupId)
        && `${item.profileNo} ${item.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        .sort((a, b) => a.profileNo.localeCompare(b.profileNo, undefined, { numeric: true })), [state.profiles, groupId, search]);
    const ids = visible.filter((item) => selected.includes(item.profileId)).map((item) => item.profileId);
    const checking = visible.some((item) => ids.includes(item.profileId) && (item.status === "checking" || item.browserBusy));
    const changeGroup = (id) => { setGroupId(id); setSelected([]); };
    useEffect(() => { if (groupId !== "all" && !state.groups.some((group) => group.id === groupId)) changeGroup("all"); }, [state.groups, groupId]);
    const act = async (operation, message) => {
        if (busy) return;
        setBusy(true); setError("");
        try {
            await operation();
            setDialog(null);
            if (message) showToast?.(message, "success");
        } catch (failure) { setError(failure.message || "Не вдалося виконати дію"); }
        finally { setBusy(false); }
    };
    const mutate = async (payload) => {
        const start = revision.current;
        const next = await unwrap(window.adsBot.mutateAutoupload(payload));
        if (revision.current === start) setState(next);
    };
    const refresh = async () => {
        const start = revision.current;
        const next = await unwrap(window.adsBot.getAutoupload({ refreshBrowserStates: true }));
        if (revision.current === start) setState(next);
    };
    const controlProfile = async (profile) => {
        if (profileBusy.includes(profile.profileId) || profile.browserBusy) return;
        setProfileBusy((current) => [...current, profile.profileId]);
        setError("");
        try {
            const result = await unwrap(window.adsBot.controlAutouploadProfile(profile.profileId, profile.adsPowerOpen ? "close" : "open"));
            setState((current) => ({ ...current, profiles: current.profiles.map((item) => item.profileId === result.profileId ? { ...item, adsPowerOpen: result.adsPowerOpen } : item) }));
        } catch (failure) { setError(failure.message || "Не вдалося змінити стан профілю AdsPower"); }
        finally { setProfileBusy((current) => current.filter((id) => id !== profile.profileId)); }
    };
    const open = (value) => { setDialog(value); setName(value.name ?? ""); setTarget("new"); setDeleteAdsPower(false); setError(""); };
    const submit = (event) => {
        event.preventDefault();
        if (dialog.action === "change-social-name") {
            void act(() => unwrap(window.adsBot.changeAutouploadNames(dialog.ids, socialName)), "Зміну імені поставлено в чергу. Результат з’явиться в журналі");
            return;
        }
        const payload = dialog.action === "move" || dialog.action === "remove"
            ? { action: dialog.action, ids: dialog.ids, groupId: target, ...(dialog.action === "remove" ? { deleteAdsPower } : {}) }
            : { action: dialog.action, id: dialog.id, name };
        void act(() => mutate(payload), "Зміни збережено");
    };
    return <section className="autoupload-tab">
        <div className="page-heading split"><div><p className="eyebrow">Facebook · HTTP</p><h2>Автозаливи</h2></div>
            <button className="secondary-button" disabled={busy} onClick={() => act(refresh)}><RefreshCw size={16} /> Оновити</button>
        </div>
        {error && !dialog && <p role="alert" className="autoupload-error">{error}</p>}
        <div className="autoupload-workspace">
            <aside className="autoupload-groups">
                <button className="secondary-button" disabled={busy} onClick={() => open({ action: "create", title: "Створити групу" })}><FolderPlus size={16} /> Створити групу</button>
                <button className={`autoupload-group ${groupId === "all" ? "active" : ""}`} onClick={() => changeGroup("all")}>Усі профілі <span>{state.profiles.length}</span></button>
                {state.groups.map((group) => <div key={group.id} className="autoupload-group-row">
                    <button className={`autoupload-group ${groupId === group.id ? "active" : ""}`} onClick={() => changeGroup(group.id)}>{group.name}<span>{state.profiles.filter((item) => item.groupId === group.id).length}</span></button>
                    <button className="icon-button" aria-label={`Перейменувати ${group.name}`} disabled={busy} onClick={() => open({ action: "rename", id: group.id, name: group.name, title: "Перейменувати групу" })}><Pencil size={14} /></button>
                    {group.id !== "new" && <button className="icon-button" aria-label={`Видалити ${group.name}`} disabled={busy} onClick={() => open({ action: "delete", id: group.id, title: `Видалити групу «${group.name}»?` })}><Trash2 size={14} /></button>}
                </div>)}
            </aside>
            <div className="autoupload-main">
                <div className="autoupload-toolbar">
                    <input aria-label="Пошук профілів" placeholder="Номер або назва профілю…" value={search} onChange={(event) => { setSearch(event.target.value); setSelected([]); }} />
                    <span>Вибрано: {ids.length}</span>
                    <div className="autoupload-actions" ref={actionsRoot}>
                        <button type="button" className="secondary-button" aria-expanded={actionsOpen} aria-controls="autoupload-actions-list" disabled={busy || !ids.length || checking} onClick={() => setActionsOpen(value => !value)}>Дії ▾</button>
                        {actionsOpen && !busy && ids.length > 0 && !checking && <div id="autoupload-actions-list" className="autoupload-actions-list"><button type="button" className="secondary-button" onClick={() => { setActionsOpen(false); setSocialName({ firstName: "", middleName: "", lastName: "" }); open({ action: "change-social-name", ids: [...ids], title: "Змінити ім’я соціального профілю через HTTP" }); }}><Pencil size={14} /> Змінити ім’я соціального профілю (HTTP)</button></div>}
                    </div>
                    <button className="primary-button" disabled={busy || !ids.length || checking} onClick={() => act(() => unwrap(window.adsBot.checkAutouploadSessions(ids)), "Перевірку сесій поставлено в чергу")}>Перевірити сесію</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => setFriendProfiles(visible.filter((profile) => ids.includes(profile.profileId)))}><UserPlus size={16} /> Додати в друзі</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => setShareProfiles(visible.filter(profile => ids.includes(profile.profileId)))}><Share2 size={16} /> Пошерити РК</button>
                    <button className="primary-button" disabled={busy || !ids.length || checking} onClick={() => setTransferProfiles(visible.filter(profile => ids.includes(profile.profileId)))}><Share2 size={16} /> Передати персональні РК кінгу</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => open({ action: "move", ids, title: "Перемістити профілі" })}>Перемістити</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => open({ action: "remove", ids, title: "Прибрати вибрані профілі?" })}>Прибрати</button>
                </div>
                <div className="autoupload-table-scroll"><table className="autoupload-table"><thead><tr>
                    <th><input type="checkbox" aria-label="Вибрати всі видимі профілі" checked={visible.length > 0 && ids.length === visible.length} onChange={(event) => setSelected(event.target.checked ? visible.map((item) => item.profileId) : [])} /></th>
                    <th className="autoupload-profile-control" aria-label="Запуск профілю" /><th>AdsPower</th><th>Назва профілю</th><th>Рекламні кабінети</th><th>Фанпейджі</th><th>Остання дія</th><th>Результат</th><th aria-label="Видалення профілю" />
                </tr></thead><tbody>{visible.map((profile) => {
                    const [label, tone] = statuses[profile.status] ?? statuses.error;
                    return <tr key={profile.profileId}><td><input type="checkbox" aria-label={`Вибрати профіль ${profile.profileNo}`} checked={ids.includes(profile.profileId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, profile.profileId] : current.filter((id) => id !== profile.profileId))} /></td>
                        <td><button type="button" className={`icon-button${profile.adsPowerOpen ? " danger" : ""}`} title={profile.adsPowerOpen ? "Профіль відкритий — закрити" : "Відкрити AdsPower-профіль"} aria-label={`${profile.adsPowerOpen ? "Закрити" : "Відкрити"} профіль ${profile.profileNo}`} disabled={profileBusy.includes(profile.profileId) || profile.browserBusy || profile.status === "checking"} onClick={() => controlProfile(profile)}>{profileBusy.includes(profile.profileId) || profile.browserBusy ? <LoaderCircle className="spin" size={13} /> : profile.adsPowerOpen ? <Power size={13} /> : <Play size={13} />}</button></td>
                        <td><span className="autoupload-profile-number"><AccountLed tone={tone} label={`Стан акаунта: ${label}`} title={`${label}${profile.message ? ` · ${profile.message}` : ""}`} />{profile.profileNo}</span></td>
                        <td className="autoupload-profile-name"><strong title={profile.name}>{profile.name || "Без назви"}</strong><button className="icon-button" aria-label={`Перейменувати профіль ${profile.profileNo}`} disabled={busy || profile.status === "checking" || profile.browserBusy} onClick={() => open({ action: "rename-profile", id: profile.profileId, name: profile.name, title: "Перейменувати профіль" })}><Pencil size={14} /></button>{profile.checkWarnings?.length > 0 && <small title={profile.checkWarnings.map((warning) => warning.message).join("\n")}>Дані оновлено частково</small>}</td>
                        <td><ProfileAssets profile={profile} type="adAccounts" /></td><td><ProfileAssets profile={profile} type="pages" /></td>
                        <td>{profile.lastAction ? <span className={`autoupload-status ${profile.lastAction.success ? "success" : profile.lastAction.outcomeUnknown ? "warning" : "danger"}`}>{profile.lastAction.message}</span> : "—"}</td>
                        <td><button className="secondary-button" onClick={() => setDetail(profile.profileId)}>Деталі</button></td><td><button className="icon-button danger" aria-label={`Прибрати профіль ${profile.profileNo}`} disabled={busy || profile.status === "checking" || profile.browserBusy} onClick={() => open({ action: "remove", ids: [profile.profileId], title: `Прибрати профіль №${profile.profileNo} з автозаливів?` })}><Trash2 size={16} /></button></td></tr>;
                })}</tbody></table>
                    {!visible.length && <p className="autoupload-empty">{state.profiles.length ? "Профілів за цим фільтром немає." : "Виберіть профілі у вкладці «Акаунти під коментарі» та натисніть «Додати до автозаливів»."}</p>}
                </div>
                <section className="autoupload-history" aria-label="Журнал операцій"><h3>Журнал операцій</h3>
                    {state.history.slice(0, 25).map((entry) => <button key={entry.id} onClick={() => setDetail(entry.profileId)}><time>{time(entry.checkedAt)}</time><strong>№{entry.profileNo}{entry.adAccountId ? ` · РК ${entry.adAccountId}` : ""}</strong><span className={`autoupload-status ${entry.operation && entry.operation !== "session-check" ? entry.success ? "success" : entry.outcomeUnknown ? "warning" : "danger" : statuses[entry.status]?.[1] ?? "warning"}`}>{entry.message}</span></button>)}
                    {!state.history.length && <p>Тут з’являться етапи та результати операцій.</p>}
                </section>
            </div>
        </div>
        {friendProfiles && <AutouploadFriendRequestModal profiles={friendProfiles} onClose={() => setFriendProfiles(null)} onQueued={() => { setFriendProfiles(null); showToast?.("Послідовне надсилання заявок поставлено в чергу", "success"); }} />}
        {shareProfiles && <AutouploadShareAccountsModal profiles={shareProfiles} onClose={() => setShareProfiles(null)} onQueued={() => { setShareProfiles(null); showToast?.("Надання Admin-доступу до вибраних РК поставлено в чергу", "success"); }} />}
        {transferProfiles && <AutouploadTransferModal profiles={transferProfiles} workspace={state} onClose={() => setTransferProfiles(null)} onQueued={() => { setTransferProfiles(null); showToast?.("Передачу персональних РК поставлено в чергу", "success"); }} />}
        {dialog && <WorkspaceDialog title={dialog.title} busy={busy} onClose={() => setDialog(null)}><form className="autoupload-form" onSubmit={submit}>
            {["create", "rename"].includes(dialog.action) && <label>Назва групи<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>}
            {dialog.action === "rename-profile" && <label>Назва профілю<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>}
            {dialog.action === "change-social-name" && <>
                <p>Змінити ім’я особистого Facebook-профілю для вибраних акаунтів: {dialog.ids.length}. Використовується збережена сесія без відкриття браузера. Спочатку виконайте перевірку сесії. Результат буде в журналі операцій.</p>
                {[['firstName', 'Ім’я'], ['middleName', 'Друге ім’я (необов’язково)'], ['lastName', 'Прізвище']].map(([key, label]) => <label key={key}>{label}<input required={key !== 'middleName'} maxLength={100} value={socialName[key]} onChange={event => setSocialName(current => ({ ...current, [key]: event.target.value }))} disabled={busy} /></label>)}
            </>}
            {dialog.action === "move" && <label>Група<select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>{state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
            {dialog.action === "delete" && <p>Профілі цієї групи будуть перенесені до «Нові».</p>}
            {dialog.action === "remove" && <><p>З автозаливів буде прибрано профілів: {dialog.ids.length}.</p><label className="autoupload-remove-confirm"><input type="checkbox" checked={deleteAdsPower} disabled={busy} onChange={event => setDeleteAdsPower(event.target.checked)} />Також видалити профілі в AdsPower</label>{deleteAdsPower && <p className="autoupload-error">Профілі буде видалено з AdsPower.</p>}</>}
            {error && <p role="alert" className="autoupload-error">{error}</p>}
            <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDialog(null)}>Скасувати</button><button className="primary-button" disabled={busy}>{busy ? "Зберігаємо…" : "Підтвердити"}</button></div>
        </form></WorkspaceDialog>}
        {detail && <WorkspaceDialog title="Історія профілю" onClose={() => setDetail(null)}><div className="autoupload-details">
            {state.history.filter((entry) => entry.profileId === detail).slice(0, 10).map((entry) => <article key={entry.id}><h3>№{entry.profileNo} · {time(entry.checkedAt)} · {entry.operation === "profile-name-change" ? "Зміна імені соціального профілю" : entry.operation === "ad-account-share" ? `Admin-доступ · РК ${entry.adAccountId}` : entry.operation === "friend-request" ? "Заявка в друзі" : entry.operation === "friend-request-accept" ? "Прийняття заявки" : entry.operation === "personal-account-transfer" ? "Передача персональних РК" : "Перевірка сесії"}</h3><AutouploadActionDetails entry={entry} /><ol>{(entry.steps ?? []).map((step, index) => <li key={index}>{step}</li>)}</ol>{entry.fields?.length > 0 && <p>Отримані поля: {entry.fields.join(", ")}</p>}</article>)}
            {!state.history.some((entry) => entry.profileId === detail) && <p>Перевірок ще не було.</p>}
        </div></WorkspaceDialog>}
    </section>;
}
