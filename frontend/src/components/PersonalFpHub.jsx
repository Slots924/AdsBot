import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Image, LoaderCircle, Share2, Square } from "lucide-react";
import { unwrap } from "../lib/api.js";
import FavoriteGroupSelect from "./FavoriteGroupSelect.jsx";
import SearchSelect from "./SearchSelect.jsx";
import useFanPageAccessRequest from "./useFanPageAccessRequest.jsx";

export default function PersonalFpHub({ targetUserId, setParentBusy, parentBusy = "" }) {
    const accessRequest = useFanPageAccessRequest();
    const [workspace, setWorkspace] = useState({ groups: [], profiles: [] });
    const [groupId, setGroupId] = useState("");
    const [profileId, setProfileId] = useState("");
    const [pages, setPages] = useState([]);
    const [results, setResults] = useState({});
    const [delay, setDelay] = useState(10);
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const locked = useRef(false);
    const controller = useRef(null);
    const unavailable = Boolean(parentBusy && parentBusy !== "fp-hub");
    useEffect(() => {
        setParentBusy?.(current => busy ? current || "fp-hub" : current === "fp-hub" ? "" : current);
    }, [busy, setParentBusy]);
    useEffect(() => {
        let disposed = false;
        unwrap(window.adsBot.getAutoupload()).then(value => { if (!disposed) setWorkspace(value); })
            .catch(error => { if (!disposed) setMessage(error.message); });
        return () => { disposed = true; controller.current?.abort(); };
    }, []);
    const profiles = workspace.profiles.filter(profile => String(profile.groupId) === String(groupId));
    const key = page => `${profileId}:${targetUserId}:${page.additionalProfileId}`;
    const validTarget = /^[1-9]\d{0,29}$/.test(String(targetUserId || ""));
    const load = async () => {
        if (locked.current || unavailable || !profileId) return;
        locked.current = true; setBusy("list"); setMessage(""); setPages([]); setResults({});
        try {
            const value = await unwrap(window.adsBot.getAutouploadFanPages([profileId]));
            if (!value.success) throw new Error(value.message || "Не вдалося отримати фанки");
            setPages(value.pages); setMessage(`Знайдено фанок: ${value.pages.length}`);
        } catch (error) { setMessage(error.message); }
        finally { locked.current = false; setBusy(""); }
    };
    const shareOne = async page => {
        setBusy(page.additionalProfileId);
        let value;
        try { value = await accessRequest.send({ ids: [profileId], additionalProfileId: page.additionalProfileId, targetUserId }, { signal: controller.current?.signal }); }
        catch (error) {
            if (error.outcomeUnknown) setResults(current => ({ ...current, [key(page)]: { outcomeUnknown: true } }));
            throw error;
        }
        setMessage(`${page.name} · ${value.message}`);
        if (value.success || value.outcomeUnknown) setResults(current => ({ ...current, [key(page)]: value }));
        return value;
    };
    const share = async (items, all = false) => {
        if (locked.current || unavailable || !validTarget) return;
        locked.current = true; controller.current = new AbortController();
        const signal = controller.current.signal;
        try {
            for (let index = 0; index < items.length; index++) {
                if (signal.aborted) break;
                const value = await shareOne(items[index]);
                if (!value.success || value.outcomeUnknown) break;
                if (signal.aborted) break;
                if (all && index < items.length - 1) {
                    const seconds = Math.max(0, Number(delay) + Math.random() * 10 - 5);
                    setBusy("delay"); setMessage(`Наступна фанка через ${Math.round(seconds)} с`);
                    await new Promise(resolve => {
                        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
                        const timer = setTimeout(done, seconds * 1000);
                        signal.addEventListener("abort", done, { once: true });
                    });
                }
            }
            if (signal.aborted) setMessage("Чергу зупинено. Наступні фанки не надсилались.");
        } catch (error) { setMessage(error.message); }
        finally { locked.current = false; setBusy(""); controller.current = null; }
    };
    return <><section className="personal-section fan-page-share personal-fp-hub">
        <div className="personal-section-heading"><div><span className="eyebrow">FP HUB</span><h3>Доступ до фанпейджів</h3><p>Отримувач: {targetUserId || "спочатку запустіть персональний профіль"}</p></div></div>
        <div className="personal-hub-selectors">
            <FavoriteGroupSelect groups={workspace.groups} value={groupId} onChange={value => { setGroupId(value); setProfileId(""); setPages([]); }}
                defaultName="FP Hubs" storageKey="personal-fp-hub-favorite" disabled={Boolean(busy) || unavailable} ariaLabel="Група FP HUB" />
            <SearchSelect items={profiles} value={profileId} onChange={value => { setProfileId(value); setPages([]); }} disabled={Boolean(busy) || unavailable}
                getId={item => item.profileId} getTitle={item => item.name || `№${item.profileNo}`} getSubtitle={item => `№${item.profileNo}`} ariaLabel="Профіль FP HUB" placeholder="Оберіть профіль" />
            <button type="button" className="secondary-button" disabled={!profileId || Boolean(busy) || unavailable} onClick={load}><Download size={15} /> Список фанок</button>
        </div>
        <div className="personal-inline-actions"><button type="button" className="primary-button" disabled={!validTarget || Boolean(busy) || unavailable || !pages.some(page => !results[key(page)])}
            onClick={() => share(pages.filter(page => !results[key(page)]), true)}><Share2 size={15} /> Пошарити всі</button>
            <label className="field"><span>Затримка, с · ±5 с</span><input type="number" min="0" max="3600" value={delay} disabled={Boolean(busy) || unavailable} onChange={event => setDelay(Math.min(3600, Math.max(0, Number(event.target.value) || 0)))} /></label>
            {busy && busy !== "list" && <button type="button" className="secondary-button" onClick={() => controller.current?.abort()}><Square size={14} /> Зупинити</button>}
        </div>
        <div className="fan-page-share-list">{pages.map(page => {
            const result = results[key(page)];
            return <div className="fan-page-share-row" key={page.additionalProfileId}>
                <span className="fan-page-share-avatar"><Image size={17} />{page.photoUrl && <img src={page.photoUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</span><div className="fan-page-share-name"><strong>{page.name || "Без назви"}</strong><span>{page.additionalProfileId}</span></div>
                <button type="button" className="secondary-button" disabled={Boolean(busy) || unavailable || !validTarget || Boolean(result)} onClick={() => share([page])}>
                    {busy === page.additionalProfileId ? <LoaderCircle className="spin" size={14} /> : result?.success ? <CheckCircle2 size={14} /> : <Share2 size={14} />}
                    {result?.outcomeUnknown ? "Перевірте стан" : result?.outcome === "FULL_CONTROL_ALREADY_PRESENT" ? "Є доступ" : result?.success ? "Очікує" : "Пошарити"}</button>
            </div>;
        })}{!pages.length && <p className="personal-empty">Оберіть профіль і завантажте список фанок.</p>}</div>
        <p role="status" className="fan-page-share-feedback">{message}</p>
    </section>{accessRequest.dialog}</>;
}
