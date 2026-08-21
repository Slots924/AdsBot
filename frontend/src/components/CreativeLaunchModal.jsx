import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import { findGroupForGeo } from "../lib/groups.js";


const nowLocal = () => {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
};

export default function CreativeLaunchModal({
    accountKey, page, adAccounts, groups, settings, onClose, onQueued, onError,
}) {
    const [templates, setTemplates] = useState([]);
    const [countries, setCountries] = useState([]);
    const [pixels, setPixels] = useState([]);
    const [pixelsLoading, setPixelsLoading] = useState(false);
    const [manualName, setManualName] = useState(false);
    const [overrideTracking, setOverrideTracking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState({
        geo: page.geo || "", creativeName: page.creativeName || "", siteUrl: "", imagePath: "",
        deleteOldPosts: true, groupIds: [], templateId: "", adAccountId: "",
        pixelId: settings.defaultPixelId || "", utm: settings.defaultUtm || "",
        campaignName: "", startTime: nowLocal(), adSetCount: 5, dailyBudget: 5,
    });

    useEffect(() => {
        Promise.all([unwrap(window.adsBot.getTemplates()), unwrap(window.adsBot.getCountries())])
            .then(([nextTemplates, nextCountries]) => {
                setTemplates(nextTemplates); setCountries(nextCountries);
                setDraft((current) => ({ ...current, templateId: String(nextTemplates[0]?.id || "") }));
            }).catch(onError);
    }, []);

    useEffect(() => {
        if (!draft.geo || draft.groupIds.length) return;
        const match = findGroupForGeo(groups, draft.geo);
        if (match) setDraft((current) => ({ ...current, groupIds: [String(match.groupId)] }));
    }, [draft.geo, groups]);

    const selectedTemplate = templates.find((item) => String(item.id) === draft.templateId);
    const automaticName = `${draft.geo || "GEO"} | Creo_${draft.creativeName || "?"} | ${selectedTemplate?.ageMin ?? 18}+`;
    useEffect(() => {
        if (!manualName) setDraft((current) => ({ ...current, campaignName: automaticName }));
    }, [automaticName, manualName]);

    const loadPixels = async () => {
        if (!draft.adAccountId) return;
        setPixelsLoading(true);
        try { setPixels(await unwrap(window.adsBot.getAdPixels(accountKey, draft.adAccountId))); }
        catch (error) { onError({ ...errorDetails(error), title: "Не вдалося завантажити Pixel" }); }
        finally { setPixelsLoading(false); }
    };
    useEffect(() => { if (overrideTracking) loadPixels(); }, [draft.adAccountId, overrideTracking]);

    const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const canSubmit = draft.geo && draft.creativeName && draft.siteUrl && draft.templateId
        && draft.adAccountId && draft.pixelId && draft.groupIds.length && draft.campaignName;
    const submit = async (event) => {
        event.preventDefault();
        if (!canSubmit || saving) return;
        setSaving(true);
        try {
            const result = await unwrap(window.adsBot.startCreativeLaunch({
                ...draft, accountKey, pageId: String(page.id), templateId: Number(draft.templateId),
                startTime: new Date(draft.startTime).toISOString(), adSetCount: Number(draft.adSetCount),
                dailyBudget: Number(draft.dailyBudget), campaignNameManual: manualName,
                createPaused: settings.createCampaignsPaused, browserMode: settings.commentBrowserMode,
                disableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
            }));
            onQueued(result);
        } catch (error) { onError({ ...errorDetails(error), title: "Не вдалося поставити запуск у чергу" }); }
        finally { setSaving(false); }
    };

    const filteredCountries = useMemo(() => countries.slice().sort((a, b) => a.code.localeCompare(b.code)), [countries]);
    return (
        <div className="overlay" onMouseDown={() => !saving && onClose()}>
            <form className="modal creative-launch-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
                <button type="button" className="modal-close" onClick={onClose}><X size={17} /></button>
                <span className="eyebrow">Єдиний workflow</span><h2>Запустити новий креатив</h2>
                <section className="template-form-section">
                    <header><strong>Кампанія</strong></header>
                    <label className="checkbox-line"><input type="checkbox" checked={manualName} onChange={(e) => setManualName(e.target.checked)} /><span>Редагувати назву вручну</span></label>
                    <label className="field"><span>Назва кампанії</span><input value={draft.campaignName} readOnly={!manualName} onChange={(e) => update("campaignName", e.target.value)} /></label>
                    <label className="checkbox-line"><input type="checkbox" checked={draft.deleteOldPosts} onChange={(e) => update("deleteOldPosts", e.target.checked)} /><span>Видалити URL-пости серед 10 найновіших</span></label>
                </section>
                <section className="template-form-section">
                    <header><strong>Креатив</strong></header>
                    <div className="template-editor-fields two-columns">
                        <label className="field"><span>GEO</span><input list="launch-geos" value={draft.geo} onChange={(e) => update("geo", e.target.value.toUpperCase())} /><datalist id="launch-geos">{filteredCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</datalist></label>
                        <label className="field"><span>Назва креативу</span><input value={draft.creativeName} onChange={(e) => update("creativeName", e.target.value.replace(/^Creo_/i, ""))} placeholder="1 або 138V2" /></label>
                    </div>
                    <label className="field"><span>Посилання на офер</span><input type="url" value={draft.siteUrl} onChange={(e) => update("siteUrl", e.target.value)} /></label>
                    <label className="field"><span>Зображення (необов’язково)</span><div className="inline-field"><input readOnly value={draft.imagePath} /><button type="button" className="secondary-button" onClick={async () => update("imagePath", await unwrap(window.adsBot.selectImage()) || "")}>Обрати</button></div></label>
                </section>
                <section className="template-form-section">
                    <header><strong>Коментарі</strong><small>Виберіть AdsPower-групи</small></header>
                    <div className="placement-grid">{groups.map((group) => <label key={group.groupId} className="checkbox-line compact"><input type="checkbox" checked={draft.groupIds.includes(String(group.groupId))} onChange={() => update("groupIds", draft.groupIds.includes(String(group.groupId)) ? draft.groupIds.filter((id) => id !== String(group.groupId)) : [...draft.groupIds, String(group.groupId)])} /><span>{group.groupName}</span></label>)}</div>
                </section>
                <section className="template-form-section">
                    <header><strong>Рекламна кампанія</strong></header>
                    <div className="template-editor-fields two-columns">
                        <label className="field"><span>Шаблон</span><select value={draft.templateId} onChange={(e) => update("templateId", e.target.value)}><option value="">Оберіть</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                        <label className="field"><span>РК · пошук за назвою або ID</span><input list="launch-ad-accounts" value={draft.adAccountId} onChange={(e) => update("adAccountId", e.target.value)} placeholder="act_…"/><datalist id="launch-ad-accounts">{adAccounts.map((item) => <option key={item.id} value={item.id}>{item.localName} · {item.name}</option>)}</datalist></label>
                    </div>
                    <label className="checkbox-line"><input type="checkbox" checked={overrideTracking} onChange={(e) => { setOverrideTracking(e.target.checked); if (!e.target.checked) setDraft((c) => ({ ...c, pixelId: settings.defaultPixelId || "", utm: settings.defaultUtm || "" })); }} /><span>Ввести Pixel і UTM вручну</span></label>
                    {overrideTracking && <><div className="inline-field"><label className="field grow"><span>Pixel · пошук за назвою або ID</span><input list="launch-pixels" value={draft.pixelId} onChange={(e) => update("pixelId", e.target.value)} placeholder="Pixel ID"/><datalist id="launch-pixels">{pixels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></label><button type="button" className="icon-button" onClick={loadPixels}><RefreshCw className={pixelsLoading ? "spin" : ""} size={16} /></button></div><label className="field"><span>UTM</span><textarea rows="3" value={draft.utm} onChange={(e) => update("utm", e.target.value)} /></label></>}
                    {!overrideTracking && <div className="notice info">Pixel {draft.pixelId || "не задано"}; UTM береться з глобальних налаштувань.</div>}
                    <div className="template-editor-fields three-columns"><label className="field"><span>Старт</span><input type="datetime-local" value={draft.startTime} onChange={(e) => update("startTime", e.target.value)} /></label><label className="field"><span>Ad sets</span><input type="number" min="1" value={draft.adSetCount} onChange={(e) => update("adSetCount", e.target.value)} /></label><label className="field"><span>Бюджет / ad set</span><input type="number" min="0" step="0.01" value={draft.dailyBudget} onChange={(e) => update("dailyBudget", e.target.value)} /></label></div>
                </section>
                <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Скасувати</button><button className="primary-button" disabled={!canSubmit || saving}>{saving && <LoaderCircle className="spin" size={16} />}Поставити в чергу</button></div>
            </form>
        </div>
    );
}
