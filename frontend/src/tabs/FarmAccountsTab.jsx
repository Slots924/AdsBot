import { useCallback, useEffect, useRef, useState } from "react";
import FarmAddModal from "../components/FarmAddModal.jsx";
import FarmSettings from "../components/FarmSettings.jsx";
import WorkspaceDialog from "../components/WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";
import { farmActionLabels, normalizeFarmSettings } from "../../../services/farming/farmSettings.js";
import "../styles/farming.css";

const date = (value) => value ? new Date(value).toLocaleString("uk-UA") : "—";
export const farmDuration = (ms) => ms == null ? "—" : `${Math.floor(ms / 3600000)} год ${Math.floor(ms / 60000) % 60} хв ${Math.floor(ms / 1000) % 60} с`;
const outcomes = { completed: "Завершено", timeout: "Таймаут", failed: "Помилка", cancelled: "Скасовано", check_failed: "Не пройдено перевірки", skipped: "Пропущено", running: "Виконується", interrupted: "Перервано", completed_with_warnings: "Завершено із зауваженнями" };
const stateLabels = { working: "Активний", banned: "Бан", not_ready: "Профіль не готовий", not_logged_in: "Не авторизований", inactive: "Неактивний", error: "Помилка перевірки", failed: "Перевірку не завершено", failed_loggedIn: "Не авторизований", failed_active: "Неактивний", failed_ensureEnglish: "Не вдалося змінити мову" };

export default function FarmAccountsTab({ groups: adsPowerGroups = [], showToast = () => {} }) {
    const [state, setState] = useState({ groups: [], members: [], history: { runs: [], memberships: [] } });
    const [groupId, setGroupId] = useState("");
    const [selected, setSelected] = useState([]);
    const [section, setSection] = useState("accounts");
    const [draft, setDraft] = useState({ groupId: null, name: "", notes: "" });
    const [settings, setSettings] = useState(null);
    const [pool, setPool] = useState([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState(null);
    const [actions, setActions] = useState({});
    const [runSettings, setRunSettings] = useState(null);
    const [targetAdsGroup, setTargetAdsGroup] = useState("");
    const initialized = useRef(false);
    const sequence = useRef(0);
    const group = state.groups.find((item) => item.id === groupId);
    const groupDraft = draft.groupId === groupId ? draft : { groupId, name: group?.name ?? "", notes: group?.notes ?? "" };
    const load = useCallback(async () => {
        const request = ++sequence.current;
        const snapshot = await unwrap(window.adsBot.getFarmSnapshot(groupId));
        if (request !== sequence.current) return;
        setState(snapshot);
        if (!initialized.current) { setSettings(snapshot.settings); setPool(snapshot.pool); initialized.current = true; }
        if (!groupId && snapshot.groups.length) setGroupId(snapshot.groups[0].id);
    }, [groupId]);
    useEffect(() => {
        load().catch((failure) => setError(failure.message));
        const timer = setInterval(() => load().catch(() => {}), 5000);
        return () => { clearInterval(timer); sequence.current++; };
    }, [load]);
    useEffect(() => { setSelected([]); }, [groupId]);
    const perform = async (operation) => {
        if (busy) return;
        setBusy(true); setError("");
        try { await operation(); await load(); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const chooseGroup = (id) => { setState((current) => ({ ...current, members: [], history: { runs: [], memberships: [] } })); setGroupId(id); };
    const select = (no) => setSelected((values) => values.includes(no) ? values.filter((value) => value !== no) : [...values, no]);
    const selectedMembers = state.members.filter((member) => selected.includes(member.profileNo));
    const start = () => {
        setRunSettings(state.settings);
        setActions(Object.fromEntries(Object.entries(state.settings.actions).map(([key, value]) => [key, { ...value, enabled: false }])));
        setModal("run");
    };
    return <section className="farm-tab">
        <div className="page-heading split"><div><p className="eyebrow">Групи · Сесії · Результати</p><h2>Фарм акаунтів</h2></div><div className="inline-actions"><button className="secondary-button" disabled={busy} onClick={() => setModal("create")}>Створити групу</button><button className="secondary-button" disabled={busy} onClick={() => perform(load)}>Оновити</button></div></div>
        {error && <p role="alert" className="farm-error">{error}</p>}
        <nav className="farm-subtabs">{[["accounts", "Акаунти"], ["compare", "Порівняння"], ["history", "Історія"], ["settings", "Налаштування"]].map(([key, label]) => <button className={`secondary-button ${section === key ? "active" : ""}`} key={key} onClick={() => setSection(key)}>{label}</button>)}</nav>
        {section === "settings" && settings && <FarmSettings settings={settings} onChange={setSettings} pool={pool} onPoolChange={setPool} busy={busy} onSave={() => perform(async () => {
            const valid = normalizeFarmSettings(settings);
            const savedPool = await unwrap(window.adsBot.saveFarmPool(pool)); setPool(savedPool);
            setSettings(await unwrap(window.adsBot.saveFarmSettings(valid))); showToast("Налаштування збережено", "success");
        })} />}
        {section === "compare" && <><p>Враховується вся історія поточного складу кожної групи, включно з діями до перенесення. Невідомий стан не означає, що акаунт активний.</p><div className="farm-table-scroll"><table><thead><tr><th>Група</th><th>Акаунти</th><th>Відомі бани</th><th>Бани, %</th><th>Оформлення UI / API ∑</th><th>Комент-задачі ∑ / середнє</th><th>Лайк-задачі ∑ / середнє</th><th>Сесії ∑ / середнє</th><th>Час фарму ∑ / середнє</th><th>Період фарму</th></tr></thead><tbody>{state.groups.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.count}</td><td>{item.banned}</td><td>{item.bannedPercent.toFixed(1)}</td><td>{item.totals.setupUiCount} / {item.totals.setupApiCount}<small>Середнє: {item.averages.setupUiCount.toFixed(1)} / {item.averages.setupApiCount.toFixed(1)}</small></td><td>{item.totals.commentTaskCount} / {item.averages.commentTaskCount.toFixed(1)}</td><td>{item.totals.reactionTaskCount} / {item.averages.reactionTaskCount.toFixed(1)}</td><td>{item.totals.farmSessionCount} / {item.averages.farmSessionCount.toFixed(1)}</td><td>{farmDuration(item.totals.farmTimeMs)} / {farmDuration(item.averages.farmTimeMs)}</td><td>{farmDuration(item.farmPeriodMs)}</td></tr>)}</tbody></table></div></>}
        {["accounts", "history"].includes(section) && <><label className="farm-group-picker">Група фарму<select aria-label="Група фарму" value={groupId} onChange={(e) => chooseGroup(e.target.value)}><option value="">Оберіть групу</option>{state.groups.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}</select></label>{!group && <p>Створіть групу та додайте акаунти з вкладки «Акаунти під коментарі».</p>}</>}
        {section === "accounts" && group && <>
            <div className="farm-group-info farm-form"><label>Назва групи<input aria-label="Назва групи" value={groupDraft.name} onChange={(e) => setDraft({ ...groupDraft, name: e.target.value })} /></label><label>Помітки<textarea aria-label="Помітки" rows={5} value={groupDraft.notes} onChange={(e) => setDraft({ ...groupDraft, notes: e.target.value })} placeholder="Як фармилися акаунти, спостереження, результати…" /></label><div className="inline-actions"><button className="secondary-button" disabled={busy} onClick={() => perform(() => unwrap(window.adsBot.saveFarmGroup({ id: groupId, name: groupDraft.name, notes: groupDraft.notes })))}>Зберегти групу</button><button className="secondary-button" disabled={busy} onClick={() => setModal("delete")}>Видалити групу</button></div></div>
            <p>Акаунтів: {group.count} · Відомих банів: {group.banned} ({group.bannedPercent.toFixed(1)}%) · Сесій: {group.totals.farmSessionCount} · Час фарму: {farmDuration(group.totals.farmTimeMs)}</p>
            <p>{Object.entries(group.outcomes ?? {}).filter(([, count]) => count).map(([key, count]) => `${outcomes[key]}: ${count}`).join(" · ")}</p>
            <div className="inline-actions farm-toolbar">
                <button className="primary-button" disabled={busy || !selectedMembers.length || !settings} onClick={start}>Фарм вибраних ({selectedMembers.length})</button>
                <button className="secondary-button" disabled={busy || !selectedMembers.length} onClick={() => perform(async () => { await unwrap(window.adsBot.checkCommentAccounts({ profileNos: selected })); showToast("Перевірку поставлено в чергу", "success"); })}>Перевірити акаунти</button>
                <button className="secondary-button" disabled={busy || !selectedMembers.length} onClick={() => setModal("move")}>Перенести до групи фарму</button>
                <button className="secondary-button" disabled={busy || !selectedMembers.length} onClick={() => perform(async () => { await unwrap(window.adsBot.assignFarmProfiles(null, selected)); setSelected([]); })}>Вилучити з групи</button>
                <select aria-label="Нова група AdsPower" value={targetAdsGroup} onChange={(e) => setTargetAdsGroup(e.target.value)}><option value="">Група AdsPower</option>{adsPowerGroups.map((item) => <option key={item.groupId} value={item.groupId}>{item.groupName}</option>)}</select>
                <button className="secondary-button" disabled={busy || !selectedMembers.length || !targetAdsGroup} onClick={() => perform(() => unwrap(window.adsBot.moveAdsPowerProfiles(selectedMembers.map((m) => m.profileId), targetAdsGroup)))}>Змінити AdsPower-групу</button>
            </div>
            <div className="farm-table-scroll"><table><thead><tr><th><input aria-label="Вибрати всі акаунти" type="checkbox" checked={state.members.length > 0 && selectedMembers.length === state.members.length} onChange={(e) => setSelected(e.target.checked ? state.members.map((m) => m.profileNo) : [])} /></th><th>№</th><th>Назва AdsPower</th><th>Група AdsPower</th><th>Стан / перевірено</th><th>Оформлення UI / API</th><th>Комент-задачі</th><th>Лайк-задачі</th><th>Фарм-сесії</th><th>Результати сесій</th><th>Час фарму</th><th>Період фарму</th></tr></thead><tbody>{state.members.map((member) => <tr key={member.profileNo}>
                <td><input type="checkbox" aria-label={`Вибрати ${member.profileNo}`} checked={selected.includes(member.profileNo)} onChange={() => select(member.profileNo)} /></td><td>{member.profileNo}</td><td><button className="farm-name" onClick={() => setModal({ rename: member, name: member.name })}>{member.name || "Без назви"}</button></td><td>{adsPowerGroups.find((g) => String(g.groupId) === member.adsPowerGroupId)?.groupName || member.adsPowerGroupName || member.adsPowerGroupId || "—"}</td><td>{member.isBanned ? "Бан" : stateLabels[member.state] || "Невідомо"}<small>{date(member.checkedAt)}</small></td><td>{member.setupUiCount} / {member.setupApiCount}</td><td>{member.commentTaskCount}</td><td>{member.reactionTaskCount}</td><td>{member.farmSessionCount}</td><td>{Object.entries(member.outcomes).filter(([, value]) => value).map(([key, value]) => <small key={key}>{outcomes[key]}: {value}</small>)}</td><td>{farmDuration(member.farmTimeMs)}</td><td>{farmDuration(member.farmPeriodMs)}<small>{date(member.farmFirstAt)} — {date(member.farmLastAt)}</small></td>
            </tr>)}</tbody></table></div>
        </>}
        {section === "history" && group && <div className="farm-history">{!state.history.runs.length && <p>Запусків ще немає.</p>}{state.history.runs.map((run) => <details key={run.id}><summary>{date(run.startedAt)} · {outcomes[run.outcome] ?? run.outcome} · акаунтів: {run.profileNos.length}</summary><p>Воркери: {run.settings.workers}, таймаут: {run.settings.timeoutSeconds} с</p><details><summary>Налаштування запуску</summary><pre>{JSON.stringify(run.settings, null, 2)}</pre></details>{run.sessions.map((session) => <details key={session.id}><summary>№{session.profileNo} · {outcomes[session.outcome]} · {farmDuration(session.farmTimeMs)}</summary><p>{session.reason}{session.cleanupError && ` · Закриття: ${session.cleanupError}`}</p><ul>{session.events.map((event, i) => <li key={i}>{date(event.at)} · {event.action}: {event.status}{event.reason && ` · ${event.reason}`}</li>)}</ul></details>)}</details>)}<details><summary>Історія перенесень</summary><ul>{state.history.memberships.map((item) => <li key={item.id}>{date(item.occurred_at)} · №{item.profile_no} · {item.to_group === groupId ? "Додано до групи" : "Вилучено з групи"}</li>)}</ul></details></div>}
        {modal === "move" && <FarmAddModal profiles={selectedMembers} onClose={() => setModal(null)} onAdded={() => { setModal(null); setSelected([]); load().catch((failure) => setError(failure.message)); }} />}
        {modal === "create" && <GroupCreate onClose={() => setModal(null)} onCreate={(name) => perform(async () => { const created = await unwrap(window.adsBot.saveFarmGroup({ name })); setGroupId(created.id); setModal(null); })} busy={busy} />}
        {modal === "delete" && <WorkspaceDialog title="Видалити групу фарму?" onClose={() => setModal(null)} busy={busy}><p>Акаунти залишаться без групи фарму. Історія запусків збережеться в базі.</p><button className="primary-button" disabled={busy} onClick={() => perform(async () => { await unwrap(window.adsBot.deleteFarmGroup(groupId)); setGroupId(""); setModal(null); })}>Видалити</button></WorkspaceDialog>}
        {modal?.rename && <WorkspaceDialog title="Перейменувати AdsPower-профіль" onClose={() => setModal(null)} busy={busy}><form className="farm-form" onSubmit={(e) => { e.preventDefault(); perform(async () => { await unwrap(window.adsBot.renameAdsPowerProfile(modal.rename.profileId, modal.name)); setModal(null); }); }}><label>Нова назва<input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></label><button className="primary-button" disabled={busy || !modal.name.trim()}>Зберегти</button></form></WorkspaceDialog>}
        {modal === "run" && <WorkspaceDialog title="Запуск фарму" onClose={() => setModal(null)} busy={busy}><div className="farm-form">{error && <p role="alert" className="farm-error">{error}</p>}<p>Акаунтів: {selectedMembers.length} · Воркери: {runSettings.workers} · Таймаут: {runSettings.timeoutSeconds} с на акаунт</p>{Object.entries(actions).map(([key, value]) => <label key={key} className="farm-check"><input type="checkbox" checked={value.enabled} onChange={(e) => setActions({ ...actions, [key]: { ...value, enabled: e.target.checked } })} />{farmActionLabels[key]}</label>)}<button className="primary-button" disabled={busy || !Object.values(actions).some((a) => a.enabled)} onClick={() => perform(async () => { await unwrap(window.adsBot.runFarm({ groupId, profileNos: selected, actions })); setModal(null); showToast("Фарм поставлено в чергу", "success"); })}>Запустити</button></div></WorkspaceDialog>}
    </section>;
}

function GroupCreate({ onClose, onCreate, busy }) {
    const [name, setName] = useState("");
    return <WorkspaceDialog title="Нова група фарму" onClose={onClose} busy={busy}><form className="farm-form" onSubmit={(event) => { event.preventDefault(); onCreate(name); }}><label>Назва групи<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label><button className="primary-button" disabled={busy || !name.trim()}>Створити</button></form></WorkspaceDialog>;
}
