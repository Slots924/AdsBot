import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { errorDetails, unwrap } from "../lib/api.js";
import GeoSelect from "./GeoSelect.jsx";
import ImageDropzone from "./ImageDropzone.jsx";
import AdAccountSelect, { isAdAccountActive } from "./AdAccountSelect.jsx";
import CampaignCreationWizard from "./CampaignCreationWizard.jsx";
import CrmCampaignPickerModal from "./CrmCampaignPickerModal.jsx";
import { extractCreativeUrls } from "../../../services/creatives/creativeTest.js";

export default function CreativeTestModal({ accountKey, page, countries, adAccounts = [], settings, onClose, onQueued }) {
    const [draft, setDraft] = useState({ geo: page.geo || "", language: page.language || "", creativeName: page.creativeName || "", manualCreativeText: "", siteUrl: "", imagePath: "", mode: "cumulative", useCreativeFont: false });
    const [manual, setManual] = useState(false);
    const [prepared, setPrepared] = useState(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [accounts, setAccounts] = useState(adAccounts);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [adAccountId, setAdAccountId] = useState("");
    const [wizardOpen, setWizardOpen] = useState(false);
    const urls = manual ? extractCreativeUrls(draft.manualCreativeText) : [];
    const selectedAccount = accounts.find(item => String(item.id) === String(adAccountId));
    const update = (field, value) => {
        setDraft(current => ({ ...current, [field]: value }));
        setPrepared(null);
        setFailure(null);
    };
    const loadAccounts = async () => {
        setLoadingAccounts(true);
        try { setAccounts(await unwrap(window.adsBot.getAdAccounts(accountKey))); }
        catch (error) { setFailure(errorDetails(error)); }
        finally { setLoadingAccounts(false); }
    };
    useEffect(() => { loadAccounts(); }, [accountKey]);
    const prepare = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setPrepared(null);
        setFailure(null);
        try {
            const result = await unwrap(window.adsBot.prepareCreativeTest({
                ...draft,
                sourceMode: manual ? "manual" : "library",
                manualCreativeText: manual ? draft.manualCreativeText : "",
                siteUrl: manual ? urls.length === 1 ? urls[0] : urls.includes(draft.siteUrl) ? draft.siteUrl : "" : draft.siteUrl,
            }));
            if (result.selectionRequired) throw new Error("Виберіть основне посилання з тексту");
            setPrepared(result.creativeTest);
        } catch (error) { setFailure(errorDetails(error)); }
        finally { setBusy(false); }
    };
    if (wizardOpen) return <CampaignCreationWizard
        accountKey={accountKey} adAccount={selectedAccount} sourcePage={page} initialPageId={String(page.id)}
        creativeTest={prepared} testImagePath={draft.imagePath}
        createPaused={settings.createCampaignsPaused} createAdSetsPaused={settings.createAdSetsPaused} createAdsPaused={settings.createAdsPaused}
        defaultPixelId={settings.defaultPixelId} defaultUtm={settings.defaultUtm}
        onBack={() => setWizardOpen(false)} onClose={onClose} onSuccess={onQueued}
    />;
    return <div className="overlay creative-launch-overlay">
        <form className="modal creative-launch-modal" onSubmit={prepare}>
            <button type="button" className="modal-close" disabled={busy} aria-label="Закрити" onClick={onClose}><X size={18} /></button>
            <header className="creative-launch-header"><span className="eyebrow">Фанпейджа {page.name}</span><h2>Затестити креатив</h2></header>
            <fieldset className="creative-launch-scroll" disabled={busy}>
                <section className="launch-section">
                    <div className="creative-fields-row">
                        <label className="field"><span>GEO</span><GeoSelect countries={countries} value={draft.geo} onChange={value => update("geo", value)} layout="list" /></label>
                        <label className="field"><span>Мова</span><GeoSelect countries={countries} value={draft.language} onChange={value => update("language", value)} layout="list" ariaLabel="Мова креативу" /></label>
                        <label className="field"><span>Номер креативу{manual ? " (необов’язково)" : ""}</span><input value={draft.creativeName} onChange={event => update("creativeName", event.target.value.replace(/^Creo_/i, ""))} /></label>
                    </div>
                    <label className="checkbox-line"><input type="checkbox" checked={manual} onChange={event => { setManual(event.target.checked); setPrepared(null); setFailure(null); setDraft(current => ({ ...current, siteUrl: "" })); }} />Власний текст креативу</label>
                    {manual && <label className="field"><span>Текст креативу</span><textarea rows={8} value={draft.manualCreativeText} onChange={event => update("manualCreativeText", event.target.value)} /></label>}
                    {manual ? <label className="field"><span>Основне посилання</span>
                        {urls.length > 1 ? <select aria-label="Основне посилання" value={urls.includes(draft.siteUrl) ? draft.siteUrl : ""} onChange={event => update("siteUrl", event.target.value)}><option value="">Виберіть посилання</option>{urls.map(url => <option key={url} value={url}>{url}</option>)}</select>
                            : <input readOnly value={urls[0] || ""} placeholder="HTTP/HTTPS-посилання з тексту" />}
                    </label> : <label className="field"><span>Offer URL</span><div className="resource-select-row"><input type="url" value={draft.siteUrl} onChange={event => update("siteUrl", event.target.value)} /><button className="secondary-button" type="button" onClick={() => setPickerOpen(true)}>Вибрати кампанію</button></div></label>}
                    <label className="checkbox-line"><input type="checkbox" checked={draft.useCreativeFont} onChange={event => update("useCreativeFont", event.target.checked)} />Використовувати Blurry Font</label>
                    <div className="field"><span>Спільне зображення</span><ImageDropzone value={draft.imagePath} onChange={value => update("imagePath", value)} disabled={busy} /></div>
                    <label className="field"><span>Режим тестування</span><select value={draft.mode} onChange={event => update("mode", event.target.value)}><option value="cumulative">Наростаючим підсумком</option><option value="individual">Кожен окремо</option></select></label>
                    <small>Абзаци розділяє порожній рядок. Посилання буде в кожному оголошенні.</small>
                </section>
                {prepared && <section className="launch-section" aria-label="Попередній перегляд"><header><strong>Оголошень: {prepared.variants.length}</strong></header>{prepared.variants.map(variant => <details key={variant.last} open><summary>{variant.label}</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{variant.text}</p></details>)}</section>}
                <section className="launch-section"><label className="field"><span>Рекламний акаунт</span><div className="resource-select-row"><AdAccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} disabled={loadingAccounts} /><button type="button" className="icon-button" aria-label="Оновити рекламні акаунти" onClick={loadAccounts} disabled={loadingAccounts}><RefreshCw size={16} /></button></div></label></section>
                {failure && <div className="creation-error" role="alert">{failure.message}</div>}
            </fieldset>
            <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="secondary-button" disabled={busy || !draft.imagePath || (!manual && (!draft.creativeName || !draft.geo))}>{busy && <LoaderCircle className="spin" size={16} />}Підготувати варіанти</button><button type="button" className="primary-button" disabled={!prepared || !selectedAccount || !isAdAccountActive(selectedAccount) || busy} onClick={() => setWizardOpen(true)}>Далі: створення кампанії</button></div>
        </form>
        {pickerOpen && <CrmCampaignPickerModal geo={draft.geo} creativeName={draft.creativeName} onClose={() => setPickerOpen(false)} onError={setFailure} onSelect={url => { update("siteUrl", url); setPickerOpen(false); }} />}
    </div>;
}
