import { useEffect, useMemo, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import GeoSelect from "./GeoSelect.jsx";
import ImageDropzone from "./ImageDropzone.jsx";
import KeitaroCampaignPickerModal from "./KeitaroCampaignPickerModal.jsx";


function localDateTime(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}


export default function ImageAdCreationModal({
    accountKey,
    adAccount,
    settings,
    keitaroAvailableGroupIds = [],
    onClose,
    onSuccess,
}) {
    const [templates, setTemplates] = useState([]);
    const [pages, setPages] = useState([]);
    const [countries, setCountries] = useState([]);
    const [pixels, setPixels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [failure, setFailure] = useState(null);
    const [overrideTracking, setOverrideTracking] = useState(false);
    const [keitaroPickerOpen, setKeitaroPickerOpen] = useState(false);
    const [form, setForm] = useState({
        geo: "",
        creativeName: "",
        siteUrl: "",
        imagePath: "",
        templateId: "",
        pageId: "",
        campaignName: "",
        dailyBudget: 5,
        startTime: localDateTime(),
        pixelId: settings.defaultPixelId || "",
        utm: settings.defaultUtm || "",
        callToActionType: "NO_BUTTON",
    });

    useEffect(() => {
        let active = true;
        Promise.all([
            unwrap(window.adsBot.getTemplates()),
            unwrap(window.adsBot.getFanPages(accountKey)),
            unwrap(window.adsBot.getCountries()),
        ]).then(([nextTemplates, nextPages, nextCountries]) => {
            if (!active) return;
            setTemplates(nextTemplates);
            setPages(nextPages);
            setCountries(nextCountries);
            setForm((current) => ({
                ...current,
                templateId: String(nextTemplates[0]?.id ?? ""),
                pageId: String(nextPages[0]?.id ?? ""),
            }));
        }).catch((error) => {
            if (active) setFailure(errorDetails(error));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [accountKey]);

    useEffect(() => {
        if (!overrideTracking) return;
        unwrap(window.adsBot.getAdPixels(accountKey, adAccount.id))
            .then(setPixels)
            .catch((error) => setFailure(errorDetails(error)));
    }, [overrideTracking, accountKey, adAccount.id]);

    const selectedTemplate = templates.find(
        (item) => String(item.id) === form.templateId
    );
    const automaticName = useMemo(() => (
        form.geo && form.creativeName
            ? `${form.geo} | Creo_${form.creativeName.replace(/^Creo_/i, "")} | ${selectedTemplate?.ageMin ?? 18}+`
            : ""
    ), [form.geo, form.creativeName, selectedTemplate]);
    const campaignName = form.campaignName.trim() || automaticName;
    const change = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
        setFailure(null);
    };
    const canSubmit = campaignName
        && form.geo
        && form.creativeName.trim()
        && form.siteUrl.trim()
        && form.imagePath
        && form.templateId
        && form.pageId
        && Number(form.dailyBudget) > 0
        && form.startTime
        && form.pixelId.trim();

    const submit = async (event) => {
        event.preventDefault();
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        setFailure(null);
        try {
            const payload = {
                accountKey,
                adAccountId: adAccount.id,
                templateId: Number(form.templateId),
                campaignName,
                pageId: form.pageId,
                postId: "",
                adSetCount: 1,
                dailyBudget: Number(form.dailyBudget),
                startTime: new Date(form.startTime).toISOString(),
                pixelId: form.pixelId.trim(),
                utm: form.utm,
                createPaused: settings.createCampaignsPaused,
                createAdSetsPaused: settings.createAdSetsPaused,
                createAdsPaused: settings.createAdsPaused,
                creativeMode: "image",
                geo: form.geo,
                creativeName: form.creativeName.trim(),
                siteUrl: form.siteUrl.trim(),
                imagePath: form.imagePath,
                callToActionType: form.callToActionType,
            };
            await unwrap(window.adsBot.preflightCampaignCreation(payload));
            const result = await unwrap(
                window.adsBot.startCampaignCreation(payload)
            );
            onSuccess?.(result);
            onClose();
        } catch (error) {
            setFailure(errorDetails(error));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="overlay" onMouseDown={() => !submitting && onClose()}>
            <form
                className="modal campaign-wizard-modal image-ad-creation-modal"
                onSubmit={submit}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button className="modal-close" type="button" onClick={onClose}>
                    <X size={17} />
                </button>
                <div className="modal-icon"><ImagePlus /></div>
                <span className="eyebrow">Campaign → Ad Set → Ad</span>
                <h2>Опублікувати рекламне оголошення</h2>
                <p>Буде створено одну кампанію, один Ad Set і одне оголошення з вибраною картинкою.</p>

                {loading ? (
                    <div className="campaign-loading">
                        <LoaderCircle className="spin" size={20} /> Завантажуємо налаштування…
                    </div>
                ) : (
                    <>
                        <div className="form-grid">
                            <label className="field">
                                <span>GEO креативу</span>
                                <GeoSelect countries={countries} value={form.geo} onChange={(value) => change("geo", value)} layout="list" />
                            </label>
                            <label className="field">
                                <span>Назва креативу</span>
                                <input value={form.creativeName} onChange={(event) => change("creativeName", event.target.value)} placeholder="17" />
                            </label>
                            <label className="field field-wide">
                                <span>Посилання на офер</span>
                                <div className="resource-select-row"><input type="url" value={form.siteUrl} onChange={(event) => change("siteUrl", event.target.value)} placeholder="https://example.com/offer" /><button type="button" className="secondary-button" onClick={() => setKeitaroPickerOpen(true)}>Вибрати кампанію</button></div>
                            </label>
                            <label className="field">
                                <span>Шаблон кампанії</span>
                                <select value={form.templateId} onChange={(event) => change("templateId", event.target.value)}>
                                    {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                            </label>
                            <label className="field">
                                <span>Фанпейджа</span>
                                <select value={form.pageId} onChange={(event) => change("pageId", event.target.value)}>
                                    {pages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                                </select>
                            </label>
                            <label className="field">
                                <span>Денний бюджет одного Ad Set</span>
                                <input type="number" min="1" step="0.01" value={form.dailyBudget} onChange={(event) => change("dailyBudget", event.target.value)} />
                            </label>
                            <label className="field">
                                <span>Початок показів</span>
                                <input type="datetime-local" value={form.startTime} onChange={(event) => change("startTime", event.target.value)} />
                            </label>
                            <label className="field">
                                <span>Кнопка</span>
                                <select value={form.callToActionType} onChange={(event) => change("callToActionType", event.target.value)}>
                                    <option value="NO_BUTTON">Без кнопки</option>
                                    <option value="LEARN_MORE">Learn More</option>
                                    <option value="SHOP_NOW">Shop Now</option>
                                    <option value="SIGN_UP">Sign Up</option>
                                </select>
                            </label>
                            <label className="field">
                                <span>Назва campaign</span>
                                <input value={form.campaignName} onChange={(event) => change("campaignName", event.target.value)} placeholder={automaticName || "Створиться автоматично"} />
                            </label>
                        </div>

                        <ImageDropzone value={form.imagePath} onChange={(value) => change("imagePath", value)} disabled={submitting} />

                        <label className="checkbox-line">
                            <input type="checkbox" checked={overrideTracking} onChange={(event) => setOverrideTracking(event.target.checked)} />
                            <span><strong>Вибрати Pixel і мітки вручну</strong><small>Інакше використовуються значення з налаштувань.</small></span>
                        </label>
                        {overrideTracking && (
                            <div className="form-grid">
                                <label className="field">
                                    <span>Pixel</span>
                                    <select value={form.pixelId} onChange={(event) => change("pixelId", event.target.value)}>
                                        <option value="">Оберіть Pixel</option>
                                        {pixels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                                    </select>
                                </label>
                                <label className="field">
                                    <span>UTM / URL tags</span>
                                    <textarea rows="3" value={form.utm} onChange={(event) => change("utm", event.target.value)} />
                                </label>
                            </div>
                        )}

                        <div className="campaign-summary">
                            <strong>{campaignName || "Назва campaign"}</strong>
                            <span>1 Campaign · 1 Ad Set · 1 Ad</span>
                        </div>
                    </>
                )}

                {failure && (
                    <div className="inline-error">
                        <strong>{failure.message}</strong>
                        {failure.code && <small>{failure.code}</small>}
                    </div>
                )}
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Скасувати</button>
                    <button type="submit" className="primary-button" disabled={!canSubmit || submitting || loading}>
                        {submitting ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
                        Опублікувати
                    </button>
                </div>
            </form>
            {keitaroPickerOpen && <KeitaroCampaignPickerModal geo={form.geo} creativeName={form.creativeName} availableGroupIds={keitaroAvailableGroupIds} onClose={() => setKeitaroPickerOpen(false)} onError={(error) => setFailure(error)} onSelect={(url) => { change("siteUrl", url); setKeitaroPickerOpen(false); }} />}
        </div>
    );
}
