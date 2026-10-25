import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Image, LoaderCircle, Share2, ShieldCheck } from "lucide-react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function AutouploadShareFanPageModal({ profile, onClose }) {
    const [pages, setPages] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [target, setTarget] = useState("");
    const [operation, setOperation] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [results, setResults] = useState({});
    const locked = useRef(false);
    const targetId = target.trim();
    const validTarget = /^[1-9]\d{0,29}$/.test(targetId);
    const busy = operation !== null;
    const load = async () => {
        if (locked.current) return;
        locked.current = true; setOperation("list"); setFeedback(null); setPages([]); setLoaded(false);
        try {
            const result = await unwrap(window.adsBot.getAutouploadFanPages([profile.profileId]));
            if (!result.success) throw new Error(result.message || "Не вдалося отримати список фанок");
            setPages(result.pages); setLoaded(true);
        } catch (error) { setFeedback({ success: false, message: error.message }); }
        finally { locked.current = false; setOperation(null); }
    };
    const share = async page => {
        if (locked.current || !validTarget) return;
        locked.current = true; setOperation(page.additionalProfileId); setFeedback(null);
        try {
            const result = await unwrap(window.adsBot.shareAutouploadFanPage({ ids: [profile.profileId], additionalProfileId: page.additionalProfileId, targetUserId: targetId }));
            setFeedback({ success: result.success, message: `${page.name || "Фанка"} · ${result.message}` });
            if (result.success || result.outcomeUnknown) setResults(current => ({ ...current, [`${targetId}:${page.additionalProfileId}`]: result }));
        } catch (error) { setFeedback({ success: false, message: error.message }); }
        finally { locked.current = false; setOperation(null); }
    };
    return <WorkspaceDialog title="Пошарити фанку" className="fan-page-share-dialog" busy={busy} onClose={onClose}>
        <div className="fan-page-share">
            <div className="fan-page-share-context"><span className="fan-page-share-icon"><Share2 size={19} /></span><div><strong>Профіль №{profile.profileNo}</strong><span>{profile.name || "Без назви"}</span></div><span className="fan-page-share-access"><ShieldCheck size={13} /> Повний доступ</span></div>
            <button type="button" className="secondary-button fan-page-share-load" disabled={busy} onClick={load}>{operation === "list" ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{operation === "list" ? "Отримуємо фанки…" : "Отримати список фанок"}</button>
            <label className="fan-page-share-target">Facebook ID отримувача<input value={target} inputMode="numeric" autoComplete="off" maxLength={30} disabled={busy} placeholder="Введіть ID користувача" onChange={event => { setTarget(event.target.value); setFeedback(null); }} /></label>
            <div className="fan-page-share-heading"><span>Доступні фанки</span><span>{loaded ? `${pages.length}` : "—"}</span></div>
            <div className="fan-page-share-list" aria-label="Фанки для надання доступу" aria-busy={operation === "list"}>
                {!pages.length && <div className="fan-page-share-empty"><Image size={28} strokeWidth={1.3} /><strong>{operation === "list" ? "Завантажуємо список" : loaded ? "Доступних фанок немає" : "Ваші фанки з’являться тут"}</strong><span>{operation === "list" ? "Це може зайняти трохи часу" : loaded ? "Спробуйте інший профіль" : "Натисніть «Отримати список фанок»"}</span></div>}
                {pages.map(page => {
                    const result = results[`${targetId}:${page.additionalProfileId}`];
                    const sharing = operation === page.additionalProfileId;
                    return <div className="fan-page-share-row" key={page.additionalProfileId}>
                        <span className="fan-page-share-avatar"><Image size={17} />{page.photoUrl && <img src={page.photoUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</span>
                        <div className="fan-page-share-name"><strong title={page.name}>{page.name || "Без назви"}</strong><span>{page.additionalProfileId}</span></div>
                        <button type="button" className={`secondary-button fan-page-share-button${result?.success ? " is-sent" : ""}`} aria-label={`Пошарити ${page.name || page.additionalProfileId}`} disabled={busy || !validTarget || Boolean(result)} onClick={() => share(page)}>
                            {sharing ? <LoaderCircle className="spin" size={13} /> : result?.success ? <CheckCircle2 size={13} /> : <Share2 size={13} />}
                            {sharing ? "Надсилаємо…" : result?.outcomeUnknown ? "Перевірте стан" : result?.outcome === "FULL_CONTROL_ALREADY_PRESENT" ? "Є доступ" : result?.success ? "Очікує" : "Пошарити"}
                        </button>
                    </div>;
                })}
            </div>
            <div className={`fan-page-share-feedback${feedback ? feedback.success ? " is-success" : " is-error" : ""}`} role={feedback?.success === false ? "alert" : "status"} aria-live="polite">
                {feedback ? <>{feedback.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{feedback.message}</span></> : <span>{busy && operation !== "list" ? "Надаємо доступ. Вікно залишиться відкритим." : "Пошарте потрібні фанки по черзі — вікно залишиться відкритим."}</span>}
            </div>
        </div>
    </WorkspaceDialog>;
}
