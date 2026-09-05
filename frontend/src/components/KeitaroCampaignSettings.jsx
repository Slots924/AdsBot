import { useEffect, useMemo, useState } from "react";
import { Check, Globe2, LoaderCircle, Pencil, Plus, Radio, Trash2, X } from "lucide-react";

import { GrayField, GraySelect } from "./gray-ui/index.js";
import { errorDetails, unwrap } from "../lib/api.js";


const blankPixel = () => ({ id: "", name: "", pixelId: "", token: "" });
const blankDomain = () => ({ id: "", originalGeo: "", name: "", geo: "", domainId: "" });


export default function KeitaroCampaignSettings({ onError = () => {}, showToast }) {
    const [settings, setSettings] = useState({ pixels: [], defaultPixelId: "", domainMappings: [], domainsByGeo: {} });
    const [countries, setCountries] = useState([]);
    const [domains, setDomains] = useState([]);
    const [pixelEditor, setPixelEditor] = useState(null);
    const [domainEditor, setDomainEditor] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([
            unwrap(window.adsBot.getKeitaroCampaignSettings()),
            unwrap(window.adsBot.getKeitaroCountries()),
            unwrap(window.adsBot.getKeitaroDomains()),
        ]).then(([nextSettings, nextCountries, nextDomains]) => {
            setSettings(nextSettings);
            setCountries(nextCountries ?? []);
            setDomains(nextDomains ?? []);
        }).catch((error) => onError({
            ...errorDetails(error),
            title: "Не вдалося завантажити налаштування Keitaro",
        }));
    }, []);

    const save = async (next, message = "Налаштування Keitaro збережено") => {
        setSaving(true);
        try {
            const saved = await unwrap(window.adsBot.saveKeitaroCampaignSettings(next));
            setSettings(saved);
            showToast?.(message, "success");
            return true;
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося зберегти налаштування Keitaro" });
            return false;
        } finally {
            setSaving(false);
        }
    };

    const savePixel = async () => {
        const draft = pixelEditor;
        if (!draft?.name.trim() || !draft.pixelId.trim() || !draft.token.trim()) return;
        const id = draft.id || crypto.randomUUID();
        const pixels = [
            ...settings.pixels.filter((pixel) => pixel.id !== id),
            { id, name: draft.name.trim(), pixelId: draft.pixelId.trim(), token: draft.token.trim() },
        ];
        const ok = await save({
            ...settings,
            pixels,
            defaultPixelId: settings.defaultPixelId || id,
        }, draft.id ? "Піксель оновлено" : "Піксель додано");
        if (ok) setPixelEditor(null);
    };

    const deletePixel = async (pixel) => {
        if (!window.confirm(`Видалити піксель «${pixel.name}»?`)) return;
        const pixels = settings.pixels.filter((item) => item.id !== pixel.id);
        await save({
            ...settings,
            pixels,
            defaultPixelId: settings.defaultPixelId === pixel.id
                ? (pixels[0]?.id ?? "")
                : settings.defaultPixelId,
        }, "Піксель видалено");
    };

    const saveDomain = async () => {
        const draft = domainEditor;
        if (!draft?.geo || !draft.domainId) return;
        const id = draft.id || crypto.randomUUID();
        const domainMappings = [
            ...(settings.domainMappings ?? []).filter((item) => item.id !== id),
            { id, name: draft.name.trim(), geo: draft.geo, domainId: String(draft.domainId) },
        ];
        const ok = await save({ ...settings, domainMappings }, draft.id ? "GEO-домен оновлено" : "GEO-домен додано");
        if (ok) setDomainEditor(null);
    };

    const deleteDomain = async (mapping) => {
        await save({
            ...settings,
            domainMappings: (settings.domainMappings ?? []).filter((item) => item.id !== mapping.id),
        }, "GEO-домен видалено");
    };

    const domainById = useMemo(() => new Map(domains.map((item) => [String(item.id), item])), [domains]);
    const usedGeos = new Set((settings.domainMappings ?? []).map((mapping) => mapping.geo));
    const editorCountries = countries.filter((country) => (
        !usedGeos.has(country.code) || country.code === domainEditor?.originalGeo
    ));
    const editorCountryOptions = useMemo(() => editorCountries.map((country) => ({
        id: country.code,
        name: country.code,
    })), [editorCountries]);
    const domainOptions = useMemo(() => domains.map((domain) => ({
        id: String(domain.id),
        name: `${domain.name} · ID ${domain.id}`,
    })), [domains]);

    return <div className="keitaro-settings-manager">
        <section className="keitaro-resource-block">
            <header className="keitaro-resource-heading">
                <div><span className="eyebrow">Meta CAPI</span><h3>Пікселі</h3><p>Збережені Pixel ID і токени для нових кампаній.</p></div>
                <button type="button" className="secondary-button" onClick={() => setPixelEditor(blankPixel())}><Plus size={15} /> Додати</button>
            </header>
            <div className="keitaro-resource-list">
                {settings.pixels.length === 0 && <div className="keitaro-resource-empty">Пікселів ще немає.</div>}
                {settings.pixels.map((pixel) => {
                    const isDefault = settings.defaultPixelId === pixel.id;
                    return <article className={`keitaro-resource-card ${isDefault ? "selected" : ""}`} key={pixel.id}>
                        <span className="keitaro-resource-icon"><Radio size={17} /></span>
                        <span className="keitaro-resource-copy"><strong>{pixel.name}</strong><small>Pixel ID · {pixel.pixelId}</small><small>UTM · {pixel.utm}</small>{isDefault && <em><Check size={12} /> За замовчуванням</em>}</span>
                        <span className="keitaro-resource-actions">
                            {!isDefault && <button type="button" className="icon-button" title="Зробити типовим" onClick={() => save({ ...settings, defaultPixelId: pixel.id }, "Типовий піксель змінено")}><Check size={14} /></button>}
                            <button type="button" className="icon-button" title="Редагувати" onClick={() => setPixelEditor({ ...pixel })}><Pencil size={14} /></button>
                            <button type="button" className="icon-button danger" title="Видалити" onClick={() => deletePixel(pixel)}><Trash2 size={14} /></button>
                        </span>
                    </article>;
                })}
            </div>
            {pixelEditor && <div className="keitaro-inline-editor">
                <div className="keitaro-inline-editor-head"><strong>{pixelEditor.id ? "Редагувати піксель" : "Новий піксель"}</strong><button type="button" className="icon-button" onClick={() => setPixelEditor(null)}><X size={15} /></button></div>
                <div className="keitaro-inline-grid">
                    <label className="stream-field"><span>Назва</span><input value={pixelEditor.name} onChange={(event) => setPixelEditor({ ...pixelEditor, name: event.target.value })} placeholder="Наприклад, Main AT" /></label>
                    <label className="stream-field"><span>Pixel ID</span><input value={pixelEditor.pixelId} onChange={(event) => setPixelEditor({ ...pixelEditor, pixelId: event.target.value })} /></label>
                    <label className="stream-field"><span>Токен</span><input value={pixelEditor.token} onChange={(event) => setPixelEditor({ ...pixelEditor, token: event.target.value })} /></label>
                    <label className="stream-field wide"><span>UTM-мітки · формуються автоматично</span><textarea rows="3" readOnly value={pixelEditor.pixelId.trim() && pixelEditor.token.trim() ? `utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&pixel=${pixelEditor.pixelId.trim()}&ad_name={{ad.name}}&token=${pixelEditor.token.trim()}` : ""} /></label>
                </div>
                <div className="keitaro-inline-actions"><button type="button" className="secondary-button" onClick={() => setPixelEditor(null)}>Скасувати</button><button type="button" className="primary-button" disabled={saving || !pixelEditor.name.trim() || !pixelEditor.pixelId.trim() || !pixelEditor.token.trim()} onClick={savePixel}>{saving && <LoaderCircle className="spin" size={15} />} Зберегти</button></div>
            </div>}
        </section>

        <section className="keitaro-resource-block">
            <header className="keitaro-resource-heading">
                <div><span className="eyebrow">Routing</span><h3>Домени за GEO</h3><p>Кожне GEO може бути додане лише один раз і мати один типовий домен.</p></div>
                <button type="button" className="secondary-button" disabled={editorCountries.length === 0} onClick={() => setDomainEditor(blankDomain())}><Plus size={15} /> Додати GEO</button>
            </header>
            <div className="keitaro-resource-list">
                {(settings.domainMappings ?? []).length === 0 && <div className="keitaro-resource-empty">Прив’язок GEO до доменів ще немає.</div>}
                {(settings.domainMappings ?? []).slice().sort((left, right) => left.geo.localeCompare(right.geo)).map((mapping) => {
                    const domain = domainById.get(String(mapping.domainId));
                    return <article className="keitaro-resource-card" key={mapping.id}>
                        <span className="keitaro-resource-icon geo"><Globe2 size={17} /></span>
                        <span className="keitaro-resource-copy"><strong>{mapping.name || mapping.geo}</strong><small>{mapping.geo} · {domain?.name ?? `Домен ID ${mapping.domainId}`}</small></span>
                        <span className="keitaro-resource-actions"><button type="button" className="icon-button" title="Редагувати" onClick={() => setDomainEditor({ ...mapping, originalGeo: mapping.geo })}><Pencil size={14} /></button><button type="button" className="icon-button danger" title="Видалити" onClick={() => deleteDomain(mapping)}><Trash2 size={14} /></button></span>
                    </article>;
                })}
            </div>
            {domainEditor && <div className="keitaro-inline-editor keitaro-gray-editor keitaro-domain-editor kg-theme">
                <div className="keitaro-inline-editor-head"><strong>{domainEditor.originalGeo ? "Редагувати GEO-домен" : "Нове GEO"}</strong><button type="button" className="icon-button" onClick={() => setDomainEditor(null)}><X size={15} /></button></div>
                <div className="keitaro-inline-grid">
                    <GrayField label="Ім’я"><input className="kg-input" value={domainEditor.name} onChange={(event) => setDomainEditor({ ...domainEditor, name: event.target.value })} placeholder="Необов’язково" /></GrayField>
                    <GrayField label="GEO"><GraySelect portal items={editorCountryOptions} value={domainEditor.geo} onChange={(geo) => setDomainEditor({ ...domainEditor, geo: String(geo) })} placeholder="Введіть GEO" searchPlaceholder="Пошук країни або GEO…" emptyText="GEO не знайдено" ariaLabel="GEO домену" /></GrayField>
                    <GrayField label="Домен"><GraySelect portal items={domainOptions} value={domainEditor.domainId} onChange={(domainId) => setDomainEditor({ ...domainEditor, domainId: String(domainId) })} placeholder="Введіть домен" searchPlaceholder="Пошук домену…" emptyText="Доменів не знайдено" ariaLabel="Домен GEO" /></GrayField>
                </div>
                <div className="keitaro-inline-actions"><button type="button" className="secondary-button" onClick={() => setDomainEditor(null)}>Скасувати</button><button type="button" className="primary-button" disabled={saving || !domainEditor.geo || !domainEditor.domainId} onClick={saveDomain}>{saving && <LoaderCircle className="spin" size={15} />} Зберегти</button></div>
            </div>}
        </section>
    </div>;
}
