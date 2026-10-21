import { useEffect, useState } from "react";
import { X } from "lucide-react";

import GeoSelect from "./GeoSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


export default function CommentPostModal({ profiles, settings = {}, onClose, onQueued, onError }) {
    const [countries, setCountries] = useState([]);
    const [draft, setDraft] = useState({ postUrl: "", creativeGeo: "", creativeName: "", siteUrl: "", manualMode: false, manualComments: "" });
    const [saving, setSaving] = useState(false);
    const commentCount = draft.manualComments.split(/\r\n|\n|\r/).filter((line) => line.trim()).length;
    const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const canSubmit = profiles.length > 0 && draft.postUrl.trim()
        && (draft.manualMode ? commentCount > 0 : draft.creativeGeo && draft.creativeName.trim());

    useEffect(() => {
        unwrap(window.adsBot.getCountries()).then(setCountries)
            .catch((error) => onError(errorDetails(error)));
    }, []);

    const submit = async (event) => {
        event.preventDefault();
        if (!canSubmit || saving) return;
        setSaving(true);
        try {
            onQueued(await unwrap(window.adsBot.runSelectedProfilesCommenting({
                ...draft,
                profileNos: profiles.map((profile) => profile.profileNo),
                browserMode: settings.commentBrowserMode,
                disableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
                commentWorkerProxyIds: settings.commentWorkerProxyIds,
            })));
        } catch (error) {
            onError(errorDetails(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overlay">
            <form className="modal action-modal account-setup-modal" onSubmit={submit}>
                <button type="button" className="modal-close" disabled={saving} onClick={onClose}><X size={17} /></button>
                <span className="eyebrow">AdsPower</span>
                <h2>Коментувати пост</h2>
                <p>Вибрано акаунтів: {profiles.length}</p>
                <div className="account-setup-list">
                    {profiles.map((profile) => <span key={profile.profileNo}>{profile.profileNo} · {profile.name || "Без назви"}</span>)}
                </div>
                <label className="field">
                    <span>Посилання на Facebook-пост</span>
                    <input type="url" required value={draft.postUrl} disabled={saving} onChange={(event) => update("postUrl", event.target.value)} placeholder="https://www.facebook.com/..." />
                </label>
                <label className="checkbox-line compact">
                    <input type="checkbox" checked={draft.manualMode} disabled={saving} onChange={(event) => update("manualMode", event.target.checked)} />
                    <span>Ввести коментарі вручну</span>
                </label>
                <div className="form-grid">
                    <label className="field"><span>Мова креативу</span>
                        <GeoSelect countries={countries} value={draft.creativeGeo} disabled={saving || draft.manualMode} layout="list" ariaLabel="Мова креативу" placeholder="Оберіть мову" onChange={(value) => update("creativeGeo", value)} />
                    </label>
                    <label className="field"><span>Креатив</span><input value={draft.creativeName} disabled={saving || draft.manualMode} onChange={(event) => update("creativeName", event.target.value)} placeholder="139" /></label>
                </div>
                <label className="field"><span>Посилання на офер (необов’язково)</span><input value={draft.siteUrl} disabled={saving || draft.manualMode} onChange={(event) => update("siteUrl", event.target.value)} placeholder="Замість &lt;LINK&gt;; порожнє поле прибирає маркер" /></label>
                <label className="field"><span>Коментарі — кожен з нового рядка</span>
                    <textarea rows={8} value={draft.manualComments} disabled={saving || !draft.manualMode} onChange={(event) => update("manualComments", event.target.value)} placeholder={"Перший коментар\nЦе мій другий коментар\nКоментую втретє"} />
                </label>
                {draft.manualMode && <small className="settings-hint">Коментарів: {commentCount}. Порожні рядки пропускаються. Акаунти підбираються без перевірки статі.</small>}
                <p className="settings-hint">Використовуються спільні налаштування коментування: браузери, проксі та завантаження зображень. На один новий коментар — один акаунт; у разі невдачі пробуємо наступний.</p>
                <div className="form-actions">
                    <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Скасувати</button>
                    <button className="primary-button" disabled={!canSubmit || saving}>{saving ? "Додаємо…" : "У чергу"}</button>
                </div>
            </form>
        </div>
    );
}
