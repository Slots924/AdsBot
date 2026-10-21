import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import WorkspaceDialog from "../components/WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

const statuses = {
    unchecked: ["Не перевірено", "muted"], checking: ["Перевіряємо…", "pending"], active: ["Сесія активна", "success"],
    login_required: ["Потрібна авторизація", "danger"], checkpoint: ["Потрібне підтвердження", "danger"], error: ["Помилка перевірки", "warning"],
};
const time = (value) => value ? new Date(value).toLocaleString("uk-UA") : "—";

export default function AutouploadTab({ showToast }) {
    const [state, setState] = useState({ groups: [], profiles: [], history: [] });
    const [groupId, setGroupId] = useState("all");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState(null);
    const [name, setName] = useState("");
    const [target, setTarget] = useState("new");
    const [detail, setDetail] = useState(null);
    const revision = useRef(0);
    useEffect(() => {
        let live = true;
        const start = revision.current;
        const off = window.adsBot.onAutouploadUpdated((next) => {
            revision.current += 1;
            if (live) setState(next);
        });
        unwrap(window.adsBot.getAutoupload()).then((next) => { if (live && revision.current === start) setState(next); }).catch((failure) => { if (live) setError(failure.message); });
        return () => { live = false; off(); };
    }, []);
    const visible = useMemo(() => state.profiles.filter((item) => (groupId === "all" || item.groupId === groupId)
        && `${item.profileNo} ${item.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        .sort((a, b) => a.profileNo.localeCompare(b.profileNo, undefined, { numeric: true })), [state.profiles, groupId, search]);
    const ids = visible.filter((item) => selected.includes(item.profileId)).map((item) => item.profileId);
    const checking = visible.some((item) => ids.includes(item.profileId) && item.status === "checking");
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
        const next = await unwrap(window.adsBot.getAutoupload());
        if (revision.current === start) setState(next);
    };
    const open = (value) => { setDialog(value); setName(value.name ?? ""); setTarget("new"); setError(""); };
    const submit = (event) => {
        event.preventDefault();
        const payload = dialog.action === "move" || dialog.action === "remove"
            ? { action: dialog.action, ids: dialog.ids, groupId: target }
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
                    <button className="primary-button" disabled={busy || !ids.length || checking} onClick={() => act(() => unwrap(window.adsBot.checkAutouploadSessions(ids)), "Перевірку сесій поставлено в чергу")}>Перевірити сесію</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => open({ action: "move", ids, title: "Перемістити профілі" })}>Перемістити</button>
                    <button className="secondary-button" disabled={busy || !ids.length || checking} onClick={() => open({ action: "remove", ids, title: "Прибрати вибрані профілі?" })}>Прибрати</button>
                </div>
                <div className="autoupload-table-scroll"><table className="autoupload-table"><thead><tr>
                    <th><input type="checkbox" aria-label="Вибрати всі видимі профілі" checked={visible.length > 0 && ids.length === visible.length} onChange={(event) => setSelected(event.target.checked ? visible.map((item) => item.profileId) : [])} /></th>
                    <th>№ AdsPower</th><th>Назва профілю</th><th>Статус</th><th>Остання перевірка</th><th>Результат</th>
                </tr></thead><tbody>{visible.map((profile) => {
                    const [label, tone] = statuses[profile.status] ?? statuses.error;
                    return <tr key={profile.profileId}><td><input type="checkbox" aria-label={`Вибрати профіль ${profile.profileNo}`} checked={ids.includes(profile.profileId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, profile.profileId] : current.filter((id) => id !== profile.profileId))} /></td>
                        <td>{profile.profileNo}</td><td>{profile.name || "Без назви"}</td><td><span className={`autoupload-status ${tone}`} title={profile.message}>{label}</span></td><td>{time(profile.checkedAt)}</td>
                        <td><button className="secondary-button" onClick={() => setDetail(profile.profileId)}>Деталі</button></td></tr>;
                })}</tbody></table>
                    {!visible.length && <p className="autoupload-empty">{state.profiles.length ? "Профілів за цим фільтром немає." : "Виберіть профілі у вкладці «Акаунти під коментарі» та натисніть «Додати до автозаливів»."}</p>}
                </div>
                <section className="autoupload-history" aria-label="Журнал перевірок"><h3>Останні перевірки</h3>
                    {state.history.slice(0, 25).map((entry) => <button key={entry.id} onClick={() => setDetail(entry.profileId)}><time>{time(entry.checkedAt)}</time><strong>№{entry.profileNo}</strong><span className={`autoupload-status ${statuses[entry.status]?.[1] ?? "warning"}`}>{entry.message}</span></button>)}
                    {!state.history.length && <p>Тут з’являться етапи та результати перевірок.</p>}
                </section>
            </div>
        </div>
        {dialog && <WorkspaceDialog title={dialog.title} busy={busy} onClose={() => setDialog(null)}><form className="autoupload-form" onSubmit={submit}>
            {["create", "rename"].includes(dialog.action) && <label>Назва групи<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>}
            {dialog.action === "move" && <label>Група<select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>{state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
            {dialog.action === "delete" && <p>Профілі цієї групи будуть перенесені до «Нові».</p>}
            {dialog.action === "remove" && <p>З локального списку буде прибрано профілів: {dialog.ids.length}. Профілі в AdsPower збережуться.</p>}
            {error && <p role="alert" className="autoupload-error">{error}</p>}
            <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setDialog(null)}>Скасувати</button><button className="primary-button" disabled={busy}>{busy ? "Зберігаємо…" : "Підтвердити"}</button></div>
        </form></WorkspaceDialog>}
        {detail && <WorkspaceDialog title="Результати перевірки сесії" onClose={() => setDetail(null)}><div className="autoupload-details">
            {state.history.filter((entry) => entry.profileId === detail).slice(0, 10).map((entry) => <article key={entry.id}><h3>№{entry.profileNo} · {time(entry.checkedAt)}</h3><ol>{entry.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>{entry.fields.length > 0 && <p>Отримані поля: {entry.fields.join(", ")}</p>}</article>)}
            {!state.history.some((entry) => entry.profileId === detail) && <p>Перевірок ще не було.</p>}
        </div></WorkspaceDialog>}
    </section>;
}
