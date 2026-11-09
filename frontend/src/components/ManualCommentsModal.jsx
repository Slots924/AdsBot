import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Ban, Check, ChevronDown, Copy, ExternalLink, LoaderCircle, MessageSquareText, RefreshCw, Undo2, Users, X } from "lucide-react";
import GeoSelect from "./GeoSelect.jsx";
import MultiSelect from "./MultiSelect.jsx";
import { unwrap } from "../lib/api.js";
import "../styles/manual-comments.css";

const actor = (row) => row.profile_key || `comment:${row.id}`;
const genderLabel = (row) => row.is_author ? "Автор" : row.gender === "male" ? "Чол." : row.gender === "female" ? "Жін." : "—";
const stateLabels = { available: "Вільний", assigned: "Призначено", replaced: "Замінено", banned: "Бан", unavailable: "Недоступний" };
const writable = (row) => !row.is_author && row.should_write !== false;

export default function ManualCommentsModal({ contextKey, authorPageUrl = "", initialDraft, countries, groups, onClose, onBack }) {
    const [draft, setDraft] = useState({ ...initialDraft, openAuthorPage: false });
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState("resume");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [expanded, setExpanded] = useState(new Set());
    const [poolFilter, setPoolFilter] = useState("available");
    const inFlight = useRef(true);
    const root = useRef(null);
    const reducedMotion = useReducedMotion();
    const api = (action, input = {}) => unwrap(window.adsBot.manualCommentAction(action, {
        contextKey, ...(authorPageUrl ? { authorPageUrl } : {}), ...input,
    }));
    const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

    useEffect(() => {
        let active = true;
        const previousFocus = document.activeElement;
        root.current?.focus();
        api("resume").then((value) => {
            if (!active) return;
            setSession(value);
            if (value) setDraft({ ...value.settings, openAuthorPage: value.settings.openAuthorPage === true });
        }).catch((failure) => { if (active) setError(failure.message); })
            .finally(() => { if (active) { inFlight.current = false; setBusy(""); } });
        return () => { active = false; previousFocus?.focus?.(); };
    }, [contextKey]);

    const run = async (action, row = null, settings = {}) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(`${action}:${row?.id || ""}`);
        setError("");
        setNotice("");
        try {
            const value = await api(action, action === "start" ? { ...draft, creativeGeo: draft.language || draft.geo }
                : { sessionId: session.id, commentId: row?.id, ...settings });
            setSession(value);
            if (action === "updateSettings") setDraft({ ...value.settings, openAuthorPage: value.settings.openAuthorPage === true });
            if (action === "finish") onClose();
            else if (["open", "replace", "ban", "copy"].includes(action) && value.comments.find((item) => item.id === row?.id)?.status !== "blocked") {
                setNotice("Текст коментаря скопійовано");
            }
        } catch (failure) {
            setError(failure.message);
            if (session) {
                try { setSession(await api("get", { sessionId: session.id })); }
                catch { /* Залишаємо останній відомий стан, якщо backend недоступний. */ }
            }
        } finally {
            inFlight.current = false;
            setBusy("");
        }
    };
    const close = () => { if (!inFlight.current) session ? void run("finish") : onClose(); };
    const handleKeys = (event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const controls = [...root.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
            .filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
            event.preventDefault(); first?.focus();
        }
    };
    const comments = session?.comments || [];
    const pool = session?.pool || [];
    const completed = comments.filter((row) => writable(row) && row.status === "assumed").length;
    const total = comments.filter(writable).length;
    const available = pool.filter((item) => item.state === "available");
    const depth = (row) => {
        const seen = new Set([row.id]);
        let parent = comments.find((item) => item.id === row.parent_id);
        let level = 0;
        while (parent && !seen.has(parent.id)) {
            seen.add(parent.id); level++;
            parent = comments.find((item) => item.id === parent.parent_id);
        }
        return Math.min(level, 4);
    };

    return <div className="overlay manual-comments-overlay">
        <motion.section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="manual-comments-title"
            className="manual-comments-modal" onKeyDown={handleKeys}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 16, scale: reducedMotion ? 1 : .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .22 }}>
            <header className="mc-header">
                <div className="mc-heading-icon"><MessageSquareText size={23} /></div>
                <div><span className="eyebrow">Ручний режим</span><h2 id="manual-comments-title">Коментування поста</h2></div>
                {session && <span className="mc-session-meta">{draft.language || draft.geo} · Creo_{draft.creativeName}</span>}
                <button type="button" className="icon-button" aria-label="Закрити ручне коментування" disabled={Boolean(busy)} onClick={close}><X size={20} /></button>
            </header>
            <div className="mc-feedback" aria-live="polite">
                {error ? <div className="notice danger" role="alert">{error}</div> : notice ? <span className="mc-copy-notice"><Check size={15} />{notice}</span>
                    : <span>{session ? "Відкрийте профіль — текст одразу буде в буфері обміну." : "Оберіть креатив і групи, щоб підготувати робочий пул."}</span>}
            </div>
            <label className="checkbox-line mc-author-option">
                <input type="checkbox" checked={draft.openAuthorPage === true} disabled={Boolean(busy) || !authorPageUrl || session?.finalizing}
                    onChange={(event) => session ? void run("updateSettings", null, { openAuthorPage: event.target.checked }) : update("openAuthorPage", event.target.checked)} />
                <span>Відкривати одразу сторінку автора</span>
            </label>
            {!session ? <form className="mc-setup" onSubmit={(event) => { event.preventDefault(); void run("start"); }}>
                <div className="mc-setup-title"><span className="mc-step">01</span><div><h3>Підготовка сеансу</h3><p>Виберіть джерело коментарів та акаунтів.</p></div></div>
                <div className="mc-config-grid">
                    <label className="field"><span>GEO</span><GeoSelect countries={countries} value={draft.geo} layout="list" disabled={Boolean(busy)} onChange={(value) => update("geo", value)} /></label>
                    <label className="field"><span>Мова</span><div className="inline-field"><GeoSelect countries={countries} value={draft.language} layout="list" ariaLabel="Мова коментарів" disabled={Boolean(busy)} placeholder="Як GEO" onChange={(value) => update("language", value)} />{draft.language && <button type="button" className="icon-button" aria-label="Очистити мову" disabled={Boolean(busy)} onClick={() => update("language", "")}><X size={14} /></button>}</div></label>
                    <label className="field"><span>Номер креативу</span><input value={draft.creativeName} disabled={Boolean(busy)} onChange={(event) => update("creativeName", event.target.value.replace(/^Creo_/i, ""))} placeholder="202" /></label>
                </div>
                <label className="field"><span>Групи акаунтів для коментарів</span><MultiSelect items={groups} value={draft.groupIds} disabled={Boolean(busy)} placeholder="Оберіть групи" onChange={(value) => update("groupIds", value)} /></label>
                <label className="field"><span>Offer URL (необов’язково)</span><input value={draft.siteUrl} disabled={Boolean(busy)} onChange={(event) => update("siteUrl", event.target.value)} placeholder="Посилання замість <LINK>" /></label>
                <div className="mc-setup-note"><Users size={18} /><span>Пул формується з акаунтів із тегом чоловіка або жінки, без BAN і LOGIN_ERROR.</span></div>
                <div className="form-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onBack}><ArrowLeft size={16} /> Назад</button>
                    <button className="primary-button" disabled={Boolean(busy) || !draft.geo || !String(draft.creativeName).trim() || !draft.groupIds.length}>{busy ? <LoaderCircle size={17} className="mc-spinner" /> : <Check size={17} />}{busy === "resume" ? "Відновлюємо…" : busy ? "Готуємо коментарі…" : "Підтвердити"}</button></div>
            </form> : <>
                <div className="mc-workspace">
                    <main className="mc-comments">
                        <div className="mc-list-heading"><div><h3>Сценарій коментарів</h3><span>Репліки одного учасника закріплюються за його профілем</span></div><span className="mc-counter">{completed}<small> / {total}</small></span></div>
                        <div className="mc-progress"><motion.div initial={false} animate={{ width: `${total ? completed / total * 100 : 0}%` }} transition={{ duration: reducedMotion ? 0 : .3 }} /></div>
                        <div className="mc-comment-list">
                            {!comments.length && <div className="mc-empty">У креативі немає коментарів</div>}
                            {comments.map((row, index) => {
                                const disabled = !writable(row) || session.finalizing;
                                const level = depth(row);
                                const locked = comments.some((other) => other.id !== row.id && actor(other) === actor(row) && other.status === "assumed");
                                const profileNo = row.profileNo || session.assignments[actor(row)];
                                const blocked = row.status === "blocked" || ["banned", "unavailable"].includes(pool.find((item) => item.profileNo === profileNo)?.state);
                                const working = busy.endsWith(`:${row.id}`);
                                return <motion.article key={row.id} layout={!reducedMotion} className={`mc-comment ${row.is_author ? "mc-author" : ""} ${row.status === "assumed" ? "mc-done" : ""} ${level ? "mc-reply" : ""}`}
                                    style={{ "--reply-depth": level }} initial={false}>
                                    <div className="mc-comment-top"><span className="mc-row-number">{row.id || index + 1}</span><span className={`mc-gender ${row.is_author ? "author" : row.gender}`}>{genderLabel(row)}</span>
                                        {row.profile_key && !row.is_author && <span className="mc-actor" title="Учасник діалогу">{row.profile_key}</span>}
                                        {row.parent_id && <span className="mc-parent">↳ {row.parent_id}</span>}
                                        <span className={`mc-row-status ${blocked ? "blocked" : ""}`}>{row.is_author ? "Коментар автора" : !writable(row) ? "Пропущено у сценарії" : blocked ? "Учасник недоступний" : row.status === "assumed" ? <><Check size={13} /> Зараховано</> : row.status === "notwritten" ? "Не написано" : ""}</span>
                                    </div>
                                    <div className="mc-comment-body"><button type="button" className={`mc-text ${expanded.has(row.id) ? "expanded" : ""}`} aria-label={`Розгорнути коментар ${row.id}`} aria-expanded={expanded.has(row.id)} title={row.text} onClick={() => setExpanded((current) => { const next = new Set(current); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next; })}><span>{row.text}</span><ChevronDown size={14} /></button>
                                        <div className="mc-row-actions">
                                            <button type="button" className="mc-open" disabled={disabled || blocked || Boolean(busy)} onClick={() => void run("open", row)} aria-label={`Відкрити профіль для коментаря ${row.id}`}>{working ? <LoaderCircle size={15} className="mc-spinner" /> : <ExternalLink size={15} />}{profileNo ? `№${profileNo}` : "Відкрити"}</button>
                                            <button type="button" className="icon-button" title={locked ? "Профіль уже написав інші репліки" : "Замінити профіль"} aria-label={`Замінити профіль для коментаря ${row.id}`} disabled={disabled || locked || !profileNo || Boolean(busy)} onClick={() => void run("replace", row)}><RefreshCw size={15} /></button>
                                            <button type="button" className="icon-button mc-ban" title="Бан і наступний профіль" aria-label={`Бан профілю для коментаря ${row.id}`} disabled={disabled || blocked || !profileNo || Boolean(busy)} onClick={() => void run("ban", row)}><Ban size={15} /></button>
                                            <button type="button" className="icon-button" title="Копіювати коментар" aria-label={`Копіювати коментар ${row.id}`} disabled={disabled || Boolean(busy)} onClick={() => void run("copy", row)}><Copy size={15} /></button>
                                            <button type="button" className="icon-button" title="Не написано — скасувати зарахування" aria-label={`Не написано: коментар ${row.id}`} disabled={disabled || row.status !== "assumed" || Boolean(busy)} onClick={() => void run("undo", row)}><Undo2 size={15} /></button>
                                        </div>
                                    </div>
                                </motion.article>;
                            })}
                        </div>
                    </main>
                    <aside className="mc-pool"><div className="mc-pool-title"><Users size={19} /><h3>Пул акаунтів</h3><span>{pool.length}</span></div>
                        <div className="mc-pool-counts"><div><span className="mc-gender male">Чол.</span><strong>{available.filter((item) => item.gender === "male").length}</strong></div><div><span className="mc-gender female">Жін.</span><strong>{available.filter((item) => item.gender === "female").length}</strong></div></div>
                        <div className="mc-pool-tabs" role="group" aria-label="Фільтр пулу"><button type="button" aria-pressed={poolFilter === "available"} onClick={() => setPoolFilter("available")}>Доступні · {available.length}</button><button type="button" aria-pressed={poolFilter === "all"} onClick={() => setPoolFilter("all")}>Усі · {pool.length}</button></div>
                        <div className="mc-pool-list">{pool.filter((item) => poolFilter === "all" || item.state === "available").map((item) => <motion.div layout={!reducedMotion} key={item.profileNo} className={`mc-profile ${item.state}`}><span className={`mc-avatar ${item.gender}`}>{item.gender === "male" ? "Ч" : "Ж"}</span><div><strong>№{item.profileNo}</strong><span title={item.name}>{item.name || "Без назви"}</span></div><small>{stateLabels[item.state]}</small></motion.div>)}{!(poolFilter === "all" ? pool : available).length && <div className="mc-empty">Доступних акаунтів: 0</div>}</div>
                        <p className="mc-pool-note">Заміна прибирає профіль із поточного пулу. Бан також додає тег у AdsPower.</p>
                    </aside>
                </div>
                <footer className="mc-footer"><div><strong>Ручні коментарі: {completed}</strong><span>Відкриті коментарі вважаються написаними. Статистика збережеться при закритті.</span></div><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={close}>{busy.startsWith("finish") ? <LoaderCircle size={16} className="mc-spinner" /> : <Check size={16} />}Завершити й закрити</button></footer>
            </>}
        </motion.section>
    </div>;
}
