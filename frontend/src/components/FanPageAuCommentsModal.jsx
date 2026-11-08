import { useState } from "react";
import { ArrowLeft, MessageSquareText, Users } from "lucide-react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import GeoSelect from "./GeoSelect.jsx";
import { unwrap } from "../lib/api.js";
import "../styles/fanpage-au-comments.css";

export default function FanPageAuCommentsModal({ initialDraft, countries, onBack, onClose, onQueued }) {
    const [draft, setDraft] = useState({ ...initialDraft });
    const [loaded, setLoaded] = useState(null);
    const [selected, setSelected] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const update = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setLoaded(null); };
    const load = async () => {
        setBusy(true); setError("");
        try {
            const result = await unwrap(window.adsBot.prepareFanPageAuComments(draft));
            setLoaded(result); setSelected(result.profiles.map(profile => profile.profileId));
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const submit = async event => {
        event.preventDefault();
        if (!loaded || !selected.length || busy) return;
        setBusy(true); setError("");
        try { onQueued(await unwrap(window.adsBot.runFanPageAuComments({ ...draft, ids: selected }))); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="AU Comments" onClose={onClose} busy={busy} className="fanpage-au-dialog">
        <p className="au-intro"><MessageSquareText size={19} /> Коментарі до поста через поточні проксі акаунтів</p>
        <form onSubmit={submit}>
            <label className="field"><span>Посилання на пост</span><input type="url" value={draft.postUrl} disabled={busy} onChange={e => update("postUrl", e.target.value)} /></label>
            <div className="au-fields">
                <label className="field"><span>GEO</span><GeoSelect countries={countries} value={draft.geo} disabled={busy} layout="list" onChange={value => update("geo", value)} /></label>
                <label className="field"><span>Мова</span><GeoSelect countries={countries} value={draft.language} placeholder="Як GEO" ariaLabel="Мова коментарів" disabled={busy} layout="list" onChange={value => update("language", value)} /></label>
                <label className="field"><span>Креатив</span><input value={draft.creativeName} disabled={busy} onChange={e => update("creativeName", e.target.value.replace(/^Creo_/i, ""))} /></label>
            </div>
            <label className="field"><span>Offer URL (необов’язково)</span><input value={draft.siteUrl} disabled={busy} onChange={e => update("siteUrl", e.target.value)} /></label>
            <div className="au-load-row"><button type="button" className="secondary-button" disabled={busy || !draft.postUrl.trim() || !(draft.language || draft.geo) || !draft.creativeName.trim()} onClick={load}><Users size={16} />{busy ? "Завантажуємо…" : "Завантажити акаунти та коментарі"}</button>{loaded && <span>{selected.length} / {loaded.profiles.length} вибрано</span>}</div>
            {loaded && <div className="au-workspace">
                <section className="au-panel"><div className="au-panel-heading"><strong>Акаунти AdsPower</strong><label><input type="checkbox" aria-label="Вибрати всі акаунти" disabled={busy || !loaded.profiles.length} checked={!!loaded.profiles.length && selected.length === loaded.profiles.length} onChange={e => setSelected(e.target.checked ? loaded.profiles.map(p => p.profileId) : [])} /> Усі</label></div>
                    <div className="au-scroll">{loaded.profiles.map(profile => <label className="au-profile" key={profile.profileId}><input type="checkbox" disabled={busy} checked={selected.includes(profile.profileId)} onChange={e => setSelected(current => e.target.checked ? [...current, profile.profileId] : current.filter(id => id !== profile.profileId))} /><span><strong>№{profile.profileNo} · {profile.name || "Без назви"}</strong><small>{profile.gender === "male" ? "Чоловіча" : "Жіноча"}</small></span></label>)}{!loaded.profiles.length && <p className="settings-hint">Немає профілів зі статтю без BAN / LOGIN_ERROR.</p>}</div>
                </section>
                <section className="au-panel"><div className="au-panel-heading"><strong>Черга коментарів</strong><span>{loaded.prepared.commentRows.length}</span></div><ol className="au-scroll au-comments">{loaded.prepared.commentRows.map((row, index) => <li key={index}><small>{row.gender === "male" ? "Чоловіча" : "Жіноча"}</small><p>{row.text}</p></li>)}</ol></section>
            </div>}
            <p className="au-note">Один акаунт — одна спроба. Після відмови той самий коментар пробує наступний акаунт відповідної статі. Реплаї пропускаємо. IP проксі не змінюємо.</p>
            {error && <p role="alert" className="notice error">{error}</p>}
            <div className="form-actions au-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => onBack(draft)}><ArrowLeft size={15} /> Назад</button><button className="primary-button" disabled={busy || !loaded || !selected.length}><MessageSquareText size={16} /> Запустити AU Comments</button></div>
        </form>
    </WorkspaceDialog>;
}
