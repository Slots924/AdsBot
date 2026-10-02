import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Users, CreditCard, ScanLine, RefreshCw, LoaderCircle, Copy, Pencil, X, UserPlus, ShieldCheck, Check, Search } from "lucide-react";
import { GrayButton, GrayField, GrayInput, GrayModal, GraySearch, GraySelect } from "../components/gray-ui/index.js";
import { unwrap } from "../lib/api.js";
import "../styles/business-manager.css";
import { businessAssetAssignment as assigned, hasFullBusinessAccess as full } from "../../../facebook/api/businessAccess.js";

const sections = [{ id: "users", name: "Користувачі", icon: Users }, { id: "adAccounts", name: "Рекламні РК", icon: CreditCard }, { id: "pixels", name: "Пікселі", icon: ScanLine }];
const idOf = (item) => String(item.id).replace(/^act_/, "");
const matches = (item, search) => `${item.name ?? ""} ${item.id} ${item.email ?? ""} ${item.pending_email ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
const stamp = (entry) => entry?.updatedAt ? `Оновлено: ${new Date(entry.updatedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kiev" })}` : "Дані ще не завантажені";
const statusNames = { 1: "Активний", 2: "Вимкнений", 3: "Проблема оплати", 7: "Перевірка", 8: "Очікує закриття", 9: "Закритий", 100: "Очікує оплати", 101: "Очікує активації", 201: "Будь-який активний", 202: "Будь-який закритий" };

function BMModal({ busy, onClose, children, ...props }) {
    const root = useRef(null);
    useEffect(() => {
        const previous = document.activeElement;
        (root.current?.querySelector("input") ?? root.current?.querySelector("button"))?.focus();
        return () => previous?.focus?.();
    }, []);
    return <div ref={root} className="kg-theme bm-modal-theme" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
            const elements = [...root.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]")];
            const first = elements[0], last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    }}><GrayModal {...props} onClose={() => { if (!busy) onClose(); }}>{children}</GrayModal></div>;
}

function Identity({ item }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    return <div className="bm-identity"><strong title={item.name}>{item.name || item.email || "Без імені"}</strong>{(item.email || item.pending_email) && <span>{item.email || item.pending_email}</span>}
        <span className="bm-id">ID: {item.id || "Недоступний"}{item.id && <button type="button" aria-label={`Копіювати ID ${item.id}`} title={copied ? "Скопійовано" : "Копіювати ID"} onClick={async () => {
            try { await navigator.clipboard.writeText(String(item.id).replace(/^act_/, "")); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
        }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}</span></div>;
}

function AssetPicker({ dialog, busy, onRefresh, onApply, onClose }) {
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState(() => new Set(dialog.originalIds));
    const visible = dialog.assets.filter((asset) => matches(asset, search));
    const original = new Set(dialog.originalIds);
    const added = [...selected].filter((id) => !original.has(id)).length;
    const removed = [...original].filter((id) => !selected.has(id)).length;
    const upgrades = dialog.pixelId ? 0 : dialog.assets.filter((asset) => selected.has(idOf(asset)) && original.has(idOf(asset)) && !full(asset, dialog.userId, dialog.kind)).length;
    return <BMModal title={dialog.title} description="Вибрані активи надаються з повними правами" busy={busy} onClose={onClose}>
        <div className="bm-picker-toolbar"><GraySearch value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Назва або ID" /><GrayButton disabled={busy} onClick={onRefresh}><RefreshCw size={16} />Оновити</GrayButton></div>
        <div className="bm-picker-controls"><GrayButton disabled={busy} onClick={() => setSelected(new Set([...selected, ...visible.map(idOf)]))}>{search.trim() ? "Вибрати знайдені" : "Вибрати всі"}</GrayButton><GrayButton disabled={busy} onClick={() => setSelected(new Set([...selected].filter((id) => !visible.some((asset) => idOf(asset) === id))))}>{search.trim() ? "Зняти знайдені" : "Зняти всі"}</GrayButton><small>Вибрано: {selected.size} / {dialog.assets.length}</small></div>
        <div className="bm-picker-list">{visible.map((asset) => <label className="bm-picker-row" key={asset.id}><input type="checkbox" disabled={busy} checked={selected.has(idOf(asset))} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(idOf(asset)) : next.delete(idOf(asset)); setSelected(next); }} /><div><strong>{asset.name || "Без назви"}</strong><small>ID: {idOf(asset)}</small></div>{asset.account_status != null && <span className={`bm-badge ${asset.account_status === 1 ? "success" : ""}`}>{statusNames[asset.account_status] || `Статус ${asset.account_status}`}</span>}</label>)}{!visible.length && <p className="bm-empty">Нічого не знайдено</p>}</div>
        <footer className="bm-modal-footer"><small>Надати: {added} · Зняти: {removed}{upgrades > 0 && ` · Доповнити права: ${upgrades}`}</small><GrayButton disabled={busy} onClick={onClose}>Скасувати</GrayButton><GrayButton variant="primary" disabled={busy || added + removed + upgrades === 0} onClick={() => onApply([...selected])}>{busy && <LoaderCircle size={16} className="bm-spin" />}Застосувати</GrayButton></footer>
    </BMModal>;
}

export default function BusinessManagerTab({ accounts, selectedAccountKey }) {
    const clients = useMemo(() => accounts.filter((item) => ["bm", "system"].includes(item.kind) && !item.archived), [accounts]);
    const [accountKey, setAccountKey] = useState("");
    const [businessId, setBusinessId] = useState("");
    const [section, setSection] = useState("users");
    const [list, setList] = useState(null);
    const [entries, setEntries] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [email, setEmail] = useState("");
    const [inviteMessage, setInviteMessage] = useState(null);
    const [summary, setSummary] = useState(null);
    const [dialog, setDialog] = useState(null);
    const [progress, setProgress] = useState(null);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const generation = useRef(0);
    const inviteTimer = useRef(null);
    const signature = clients.map((item) => item.accountKey).join("|");
    const request = (action, extra = {}) => unwrap(window.adsBot.bmRequest({ action, accountKey, businessId, section, ...extra }));
    const entry = entries[section];
    const data = entry?.value;
    const users = entries.users?.value;
    const currentClient = clients.find((item) => item.accountKey === accountKey);

    useEffect(() => {
        if (!signature) return undefined;
        let cancelled = false;
        unwrap(window.adsBot.bmRequest({ action: "preferences" })).then((preferences) => {
            if (cancelled) return;
            const preferred = clients.find((item) => item.accountKey === preferences.accountKey) ?? clients.find((item) => item.accountKey === selectedAccountKey) ?? clients[0];
            setAccountKey(preferred.accountKey);
            setBusinessId(preferred.accountKey === preferences.accountKey ? preferences.businessId ?? "" : "");
            setSection(preferences.section ?? "users");
        }).catch((failure) => { if (!cancelled) { setAccountKey(clients[0].accountKey); setError(failure.message); } });
        return () => { cancelled = true; };
    }, [signature]);

    useEffect(() => {
        if (!accountKey) return undefined;
        let cancelled = false;
        setList(null); setEntries({}); setError(""); setSummary(null); setDialog(null); setInviteMessage(null);
        request("list").then((cached) => {
            if (cancelled) return;
            setList(cached);
            setBusinessId((current) => cached?.value?.some((item) => String(item.id) === current) ? current : String(cached?.value?.[0]?.id ?? ""));
        }).catch((failure) => { if (!cancelled) setError(failure.message); });
        return () => { cancelled = true; generation.current += 1; };
    }, [accountKey]);

    useEffect(() => {
        setEntries({}); setSearch(""); setSummary(null); setInviteMessage(null); setDialog(null); setError("");
        generation.current += 1;
    }, [businessId]);

    useEffect(() => {
        if (!accountKey || !businessId) return undefined;
        const version = generation.current;
        let cancelled = false;
        request("section").then((cached) => { if (!cancelled && generation.current === version) setEntries((current) => ({ ...current, [section]: cached })); }).catch((failure) => { if (!cancelled) setError(failure.message); });
        request("select").catch((failure) => { if (!cancelled) setError(failure.message); });
        return () => { cancelled = true; };
    }, [accountKey, businessId, section]);

    useEffect(() => {
        const unsubscribe = window.adsBot.onBMProgress?.((value) => { if (value.accountKey === accountKey && String(value.businessId) === businessId) setProgress(value); });
        return () => unsubscribe?.();
    }, [accountKey, businessId]);
    useEffect(() => () => clearTimeout(inviteTimer.current), []);

    async function run(label, work, invitation = false) {
        if (busy) return;
        setBusy(label); setError(""); setProgress(null);
        try { await work(); }
        catch (failure) {
            if (invitation) setInviteMessage({ success: false, text: failure.message });
            else setDialog({ type: "error", title: "Не вдалося виконати операцію", message: failure.message });
        } finally { setBusy(""); }
    }

    async function refreshList() {
        await run("list", async () => {
            const next = await request("list", { force: true });
            setList(next);
            setBusinessId(next.value.some((item) => String(item.id) === businessId) ? businessId : String(next.value[0]?.id ?? ""));
        });
    }

    async function refreshPage(target = section) {
        const next = await request("section", { section: target, force: true });
        setEntries((current) => ({ ...current, [target]: next }));
        return next;
    }

    function applyResult(result, target = section) {
        setEntries((current) => ({ ...current, [target]: result.snapshot }));
        setError(result.refreshError ? `Зміни виконано, але дані не оновлено: ${result.refreshError.message}` : "");
    }

    function picker(snapshot, target) {
        const isPixel = Boolean(target.pixelId);
        const owner = (isPixel ? snapshot.pixels : snapshot.users).find((item) => String(item.id) === String(isPixel ? target.pixelId : target.userId));
        if (!owner) throw new Error("Об’єкт більше не доступний");
        const assets = snapshot[isPixel ? "adAccounts" : target.kind];
        if (owner.assignmentError || assets.some((asset) => asset.assignmentError)) throw new Error("Не вдалося завантажити всі доступи. Оновіть сторінку");
        const originalIds = assets.filter((asset) => isPixel ? owner.sharedAccounts.some((account) => idOf(account) === idOf(asset)) : assigned(asset, target.userId)).map(idOf);
        return { type: "picker", ...target, assets, originalIds, revision: Date.now(), title: `${isPixel ? "РК пікселя" : target.kind === "pages" ? "Фанпейджі" : "Рекламні акаунти"} · ${owner.name || owner.email || owner.id}` };
    }

    function openPicker(target) {
        try { setDialog(picker(data, target)); } catch (failure) { setDialog({ type: "error", title: "Доступи недоступні", message: failure.message }); }
    }

    async function invite(role) {
        clearTimeout(inviteTimer.current); setInviteMessage(null);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setInviteMessage({ success: false, text: "Введіть коректну email-адресу" }); return; }
        await run(`invite-${role}`, async () => {
            const result = await request("invite", { email: email.trim(), role });
            applyResult(result, "users");
            setInviteMessage({ success: true, text: `Інвайт відправлено на ${email.trim()}` });
            inviteTimer.current = setTimeout(() => setInviteMessage(null), 5000);
        }, true);
    }

    async function mutate(action, extra = {}, target = section) {
        const result = await request(action, extra);
        applyResult(result, target);
        if (result.total != null) {
            setSummary(result);
            setDialog({ type: "result", title: "Результат зміни доступів", result, action });
        } else setDialog(null);
        if (action === "removeAccount") setEntries((current) => ({ ...current, users: null, pixels: null }));
    }

    const missing = (user) => !users || ["pages", "adAccounts"].some((kind) => users[kind].some((asset) => !asset.assignmentError && !full(asset, user.id, kind)));
    const visibleUsers = (data?.users ?? []).filter((user) => matches(user, search) && (roleFilter === "all" || roleFilter === "missing" ? roleFilter !== "missing" || missing(user) : user.role === roleFilter));
    const visibleAccounts = [...(data?.adAccounts ?? [])].filter((item) => matches(item, search)).sort((a, b) => Number(b.account_status === 1) - Number(a.account_status === 1) || (a.name ?? "").localeCompare(b.name ?? "", "uk"));
    const disabled = Boolean(busy) || !businessId;
    const totalFor = (id) => entries[id]?.value?.[id]?.length;
    const busyIcon = busy ? <LoaderCircle size={16} className="bm-spin" /> : <RefreshCw size={16} />;

    return <section className="kg-theme bm-workspace">
        <header className="bm-heading"><div><h1><Building2 size={25} />Бізнес-менеджер</h1><p>{currentClient ? `${currentClient.name} · ${currentClient.kind === "system" ? "Системний користувач" : "БМ"}` : "Для роботи додайте БМ або системного користувача у вкладці API-клієнти"}</p></div>
            <div className="bm-selectors"><GraySelect items={clients.map((item) => ({ id: item.accountKey, name: item.name }))} value={accountKey} onChange={(key) => { setBusinessId(""); setAccountKey(key); }} ariaLabel="API-клієнт БМ" placeholder="Оберіть клієнта" disabled={Boolean(busy)} portal />
                <div className="bm-business-select"><button type="button" className="bm-refresh-link" disabled={Boolean(busy) || !accountKey} onClick={refreshList}><RefreshCw size={12} className={busy === "list" ? "bm-spin" : ""} />Оновити список БМ</button><GraySelect items={list?.value ?? []} value={businessId} onChange={(id) => setBusinessId(String(id))} ariaLabel="Бізнес-менеджер" placeholder="Оберіть БМ" disabled={Boolean(busy)} portal /></div>
                <GrayButton disabled={disabled} onClick={() => run("business", async () => { for (const item of sections) await refreshPage(item.id); })}>{busyIcon}Оновити БМ</GrayButton>
            </div>
        </header>
        <div className="bm-layout"><aside className="bm-nav">{sections.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} disabled={Boolean(busy)} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setSearch(""); }}><Icon size={17} /><span>{item.name}</span>{totalFor(item.id) != null && <small>{totalFor(item.id)}</small>}</button>; })}<small className="bm-cache-note">Дані зберігаються на диску.<br />Оновлення — за кнопками.</small></aside>
            <div className="bm-content"><div className="bm-section-heading"><div><h2>{sections.find((item) => item.id === section)?.name}</h2><small>{stamp(entry)}</small></div><GrayButton disabled={disabled} onClick={() => run("section", () => refreshPage())}>{busyIcon}Оновити</GrayButton></div>
                {error && <p role="alert" className="bm-feedback error">{error}</p>}
                {section === "users" && businessId && <>
                    <div className="bm-invite-panel"><GrayField label="Email для запрошення" help="Постійний доступ · Повні права на фінанси"><GrayInput aria-label="Email для запрошення" type="email" value={email} placeholder="name@example.com" disabled={Boolean(busy)} onChange={(event) => { setEmail(event.target.value); clearTimeout(inviteTimer.current); setInviteMessage(null); }} onKeyDown={(event) => { if (event.key === "Enter" && !disabled) invite("EMPLOYEE"); }} /></GrayField><div className="bm-invite-actions"><GrayButton variant="primary" disabled={disabled} onClick={() => invite("EMPLOYEE")}>{busy === "invite-EMPLOYEE" ? <LoaderCircle className="bm-spin" size={16} /> : <UserPlus size={16} />}Запросити користувача</GrayButton><GrayButton disabled={disabled} onClick={() => invite("ADMIN")}>{busy === "invite-ADMIN" ? <LoaderCircle className="bm-spin" size={16} /> : <ShieldCheck size={16} />}Запросити адміна</GrayButton><div className="bm-invite-feedback" role="status">{inviteMessage && <span className={inviteMessage.success ? "bm-success" : "bm-error"}>{inviteMessage.success && "✓ "}{inviteMessage.text}</span>}</div></div></div>
                    <div className="bm-bulk-panel"><GrayButton disabled={disabled} onClick={() => setDialog({ type: "confirm", title: "Надати всім усі доступи?", message: "Оновимо людей, фанпейджі й рекламні акаунти та надамо кожній людині всі доступні права. Партнери та системні користувачі не змінюються.", action: "grantAll" })}>{busy === "grantAll" && <LoaderCircle className="bm-spin" size={16} />}Надати всім усі доступи</GrayButton>{busy === "grantAll" && <span role="status">{progress ? `${progress.completed} / ${progress.total}` : "Оновлюємо дані…"}</span>}{summary && <small className={summary.failed.length ? "bm-error" : "bm-success"}>Виконано {summary.successful} / {summary.total} призначень для {summary.people} людей</small>}</div>
                </>}
                {data && <div className="bm-toolbar"><GraySearch value={search} onChange={(event) => setSearch(event.target.value)} placeholder={section === "users" ? "Ім’я, пошта або ID" : "Назва або ID"} />{section === "users" && <GraySelect ariaLabel="Фільтр людей" items={[{ id: "all", name: "Усі ролі" }, { id: "EMPLOYEE", name: "Користувачі" }, { id: "ADMIN", name: "Адміністратори" }, { id: "missing", name: "Не всі доступи" }]} value={roleFilter} onChange={setRoleFilter} portal />}</div>}
                {!data ? <div className="bm-empty"><Search size={30} /><p>{!accountKey ? "Додайте БМ або системного користувача" : !businessId ? "Оновіть список і виберіть БМ" : "Немає кешованих даних. Натисніть «Оновити»"}</p></div> : <div className="bm-table-wrap">
                    {section === "users" && <table className="bm-table"><thead><tr><th>Користувач</th><th>Доступ до БМ</th><th>Фанки</th><th>РК</th><th><span className="bm-sr-only">Дії</span></th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><td><div className="bm-person"><Identity item={user} /><GrayButton iconOnly aria-label={`Змінити ім’я ${user.name}`} disabled={disabled} onClick={() => { setFirstName(user.first_name || user.name?.split(" ")[0] || ""); setLastName(user.last_name || user.name?.split(" ").slice(1).join(" ") || ""); setDialog({ type: "rename", title: "Змінити ім’я користувача", userId: user.id }); }}><Pencil size={14} /></GrayButton></div></td><td><span className="bm-badge">{user.role === "ADMIN" ? "Адміністратор" : "Частковий"}</span><small>Фінанси: {/[Ee][Dd][Ii][Tt]/.test(user.finance_permission ?? "") || user.tasks?.some((task) => ["FINANCE_EDITOR", "FINANCE_EDIT"].includes(task)) ? "повний" : user.finance_permission || "не надано"}</small></td>{["pages", "adAccounts"].map((kind) => <td key={kind}>{data[kind].some((asset) => asset.assignmentError) ? <span className="bm-error" title="Оновіть сторінку, щоб отримати всі доступи">Недоступно</span> : <><GrayButton disabled={disabled} onClick={() => openPicker({ userId: user.id, kind })}>{data[kind].filter((asset) => assigned(asset, user.id)).length} / {data[kind].length}</GrayButton>{data[kind].some((asset) => assigned(asset, user.id) && !full(asset, user.id, kind)) && <small className="bm-error">Неповні права</small>}</>}</td>)}<td><GrayButton iconOnly variant="danger" disabled={disabled} aria-label={`Видалити ${user.name}`} onClick={() => setDialog({ type: "confirm", title: "Видалити користувача з БМ?", message: `${user.name || user.email} · ID ${user.id}. Доступ до цього БМ буде втрачено.`, action: "removeUser", extra: { userId: user.id } })}><X size={16} /></GrayButton></td></tr>)}{(data.pending ?? []).filter((user) => matches(user, search) && roleFilter === "all").map((user, index) => <tr key={`pending-${user.id || index}`}><td><Identity item={user} /></td><td colSpan={4}><span className="bm-badge">Очікує прийняття</span></td></tr>)}</tbody></table>}
                    {section === "adAccounts" && <table className="bm-table"><thead><tr><th>Рекламний акаунт</th><th>Статус</th><th>Власник</th><th>Дія</th></tr></thead><tbody>{visibleAccounts.map((account) => <tr key={account.id}><td><Identity item={account} /></td><td><span className={`bm-badge ${account.account_status === 1 ? "success" : ""}`}>{statusNames[account.account_status] || `Статус ${account.account_status ?? "невідомий"}`}</span></td><td><span className="bm-badge">{account.ownership === "owned" ? "Власний" : "Надано іншою стороною"}</span><small>{account.business?.name || account.business?.id}</small></td><td><GrayButton variant="danger" disabled={disabled || account.ownership === "owned"} title={account.ownership === "owned" ? "Видалення власного РК недоступне через Graph API" : "Прибрати доступ цього БМ"} onClick={() => setDialog({ type: "confirm", title: "Прибрати наданий РК із БМ?", message: `${account.name} · ID ${idOf(account)}. Цей БМ втратить доступ до РК.`, action: "removeAccount", extra: { assetId: account.id } })}><X size={15} />Прибрати з БМ</GrayButton></td></tr>)}</tbody></table>}
                    {section === "pixels" && <table className="bm-table"><thead><tr><th>Піксель</th><th>Власність</th><th>Підключені РК</th></tr></thead><tbody>{data.pixels.filter((pixel) => matches(pixel, search)).map((pixel) => <tr key={pixel.id}><td><Identity item={pixel} /></td><td><span className="bm-badge">{pixel.ownership === "owned" ? "Власний" : "Надано іншою стороною"}</span></td><td>{pixel.assignmentError ? <span className="bm-error" title={pixel.assignmentError.message}>Не вдалося завантажити</span> : <GrayButton disabled={disabled} onClick={() => openPicker({ pixelId: pixel.id })}>РК: {data.adAccounts.filter((account) => pixel.sharedAccounts.some((item) => idOf(item) === idOf(account))).length} / {data.adAccounts.length}</GrayButton>}</td></tr>)}</tbody></table>}
                    {((section === "users" && !visibleUsers.length && !data.pending?.some((user) => roleFilter === "all" && matches(user, search))) || (section === "adAccounts" && !visibleAccounts.length) || (section === "pixels" && !data.pixels.some((pixel) => matches(pixel, search)))) && <p className="bm-empty">Нічого не знайдено</p>}
                </div>}
            </div>
        </div>
        {dialog?.type === "picker" && <AssetPicker key={dialog.revision} dialog={dialog} busy={Boolean(busy)} onClose={() => setDialog(null)} onRefresh={() => run("picker", async () => { const next = await refreshPage(); setDialog(picker(next.value, dialog)); })} onApply={(selectedIds) => run("apply", () => mutate(dialog.pixelId ? "pixelAccounts" : "userAssets", { pixelId: dialog.pixelId, userId: dialog.userId, kind: dialog.kind, originalIds: dialog.originalIds, selectedIds }))} />}
        {dialog && dialog.type !== "picker" && <BMModal title={dialog.title} busy={Boolean(busy)} onClose={() => setDialog(null)}>
            {dialog.type === "rename" ? <div className="bm-rename-fields"><GrayField label="Ім’я"><GrayInput value={firstName} disabled={Boolean(busy)} onChange={(event) => setFirstName(event.target.value)} /></GrayField><GrayField label="Прізвище"><GrayInput value={lastName} disabled={Boolean(busy)} onChange={(event) => setLastName(event.target.value)} /></GrayField></div> : dialog.type === "result" ? <><p className={dialog.result.failed.length ? "bm-error" : "bm-success"}>Успішно: {dialog.result.successful} / {dialog.result.total} · Людей: {dialog.result.people}</p>{dialog.result.refreshError && <p className="bm-error">Дані не оновлено: {dialog.result.refreshError.message}</p>}<div className="bm-result-list">{dialog.result.failed.map((failure, index) => <div key={index}><strong>{failure.userName || failure.userId || "Піксель"} · {failure.assetName || failure.assetId}</strong><small>{failure.error.message}{failure.error.graphCode && ` · Meta ${failure.error.graphCode}`}</small>{!failure.retryable && <small>Результат невідомий. Оновіть доступи перед повторною спробою.</small>}</div>)}</div></> : <p className={dialog.type === "error" ? "bm-error" : ""} role={dialog.type === "error" ? "alert" : undefined}>{dialog.message}</p>}
            <footer className="bm-modal-footer"><GrayButton disabled={Boolean(busy)} onClick={() => setDialog(null)}>{["error", "result"].includes(dialog.type) ? "Закрити" : "Скасувати"}</GrayButton>
                {dialog.type === "confirm" && <GrayButton variant={dialog.action.startsWith("remove") ? "danger" : "primary"} disabled={Boolean(busy)} onClick={() => run(dialog.action, () => mutate(dialog.action, dialog.extra))}>{busy && <LoaderCircle size={16} className="bm-spin" />}Підтвердити</GrayButton>}
                {dialog.type === "rename" && <GrayButton variant="primary" disabled={Boolean(busy) || !firstName.trim()} onClick={() => run("rename", () => mutate("rename", { userId: dialog.userId, firstName, lastName }))}>Зберегти</GrayButton>}
                {dialog.type === "result" && dialog.action === "grantAll" && dialog.result.failed.some((failure) => failure.retryable) && <GrayButton disabled={Boolean(busy)} variant="primary" onClick={() => run("grantAll", () => mutate("grantAll", { retryTargets: dialog.result.failed.filter((failure) => failure.retryable).map((failure) => failure.key) }))}>Повторити невдалі</GrayButton>}
            </footer>
        </BMModal>}
    </section>;
}
