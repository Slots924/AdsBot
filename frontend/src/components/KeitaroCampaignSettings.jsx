import { useEffect, useMemo, useState } from "react";
import { Check, Globe2, LoaderCircle, Pencil, Plus, Radio, Trash2, X } from "lucide-react";

import GeoSelect from "./GeoSelect.jsx";
import SearchSelect from "./SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


const blankPixel = () => ({ id: "", name: "", pixelId: "", token: "" });
const blankDomain = () => ({ originalGeo: "", geo: "", domainId: "" });


export default function KeitaroCampaignSettings({ onError = () => {}, showToast }) {
    const [settings, setSettings] = useState({ pixels: [], defaultPixelId: "", domainsByGeo: {} });
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
        const domainsByGeo = { ...settings.domainsByGeo };
        if (draft.originalGeo && draft.originalGeo !== draft.geo) delete domainsByGeo[draft.originalGeo];
        domainsByGeo[draft.geo] = [String(draft.domainId)];
        const ok = await save({ ...settings, domainsByGeo }, draft.originalGeo ? "GEO-домен оновлено" : "GEO-домен додано");
        if (ok) setDomainEditor(null);
    };

    const deleteDomain = async (geo) => {
        const domainsByGeo = { ...settings.domainsByGeo };
        delete domainsByGeo[geo];
        await save({ ...settings, domainsByGeo }, "GEO-домен видалено");
    };

    const domainById = useMemo(() => new Map(domains.map((item) => [String(item.id), item])), [domains]);
    const usedGeos = new Set(Object.keys(settings.domainsByGeo));
    const editorCountries = countries.filter((country) => (
        !usedGeos.has(country.code) || country.code === domainEditor?.originalGeo
    ));

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
                        <span className="keitaro-resource-copy"><strong>{pixel.name}</strong><small>Pixel ID · {pixel.pixelId}</small>{isDefault && <em><Check size={12} /> За замовчуванням</em>}</span>
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
                    <label className="stream-field wide"><span>Токен</span><input value={pixelEditor.token} onChange={(event) => setPixelEditor({ ...pixelEditor, token: event.target.value })} /></label>
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
                {Object.keys(settings.domainsByGeo).length === 0 && <div className="keitaro-resource-empty">Прив’язок GEO до доменів ще немає.</div>}
                {Object.entries(settings.domainsByGeo).sort(([left], [right]) => left.localeCompare(right)).map(([geo, domainIds]) => {
                    const domainId = String(domainIds?.[0] ?? "");
                    const domain = domainById.get(domainId);
                    return <article className="keitaro-resource-card" key={geo}>
                        <span className="keitaro-resource-icon geo"><Globe2 size={17} /></span>
                        <span className="keitaro-resource-copy"><strong>{geo}</strong><small>{domain?.name ?? `Домен ID ${domainId}`}</small></span>
                        <span className="keitaro-resource-actions"><button type="button" className="icon-button" title="Редагувати" onClick={() => setDomainEditor({ originalGeo: geo, geo, domainId })}><Pencil size={14} /></button><button type="button" className="icon-button danger" title="Видалити" onClick={() => deleteDomain(geo)}><Trash2 size={14} /></button></span>
                    </article>;
                })}
            </div>
            {domainEditor && <div className="keitaro-inline-editor">
                <div className="keitaro-inline-editor-head"><strong>{domainEditor.originalGeo ? "Редагувати GEO-домен" : "Нове GEO"}</strong><button type="button" className="icon-button" onClick={() => setDomainEditor(null)}><X size={15} /></button></div>
                <div className="keitaro-inline-grid">
                    <label className="stream-field"><span>GEO</span><GeoSelect countries={editorCountries} value={domainEditor.geo} onChange={(geo) => setDomainEditor({ ...domainEditor, geo })} placeholder="Оберіть GEO" ariaLabel="GEO домену" /></label>
                    <label className="stream-field"><span>Домен</span><SearchSelect items={domains} value={domainEditor.domainId} onChange={(domainId) => setDomainEditor({ ...domainEditor, domainId: String(domainId) })} getId={(item) => item.id} getTitle={(item) => item.name} getSubtitle={(item) => `ID ${item.id}`} placeholder="Оберіть домен" searchPlaceholder="Пошук домену…" ariaLabel="Домен GEO" /></label>
                </div>
                <div className="keitaro-inline-actions"><button type="button" className="secondary-button" onClick={() => setDomainEditor(null)}>Скасувати</button><button type="button" className="primary-button" disabled={saving || !domainEditor.geo || !domainEditor.domainId} onClick={saveDomain}>{saving && <LoaderCircle className="spin" size={15} />} Зберегти</button></div>
            </div>}
        </section>
    </div>;
}
