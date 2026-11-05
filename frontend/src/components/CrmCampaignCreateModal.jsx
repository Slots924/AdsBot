import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { errorDetails, unwrap } from "../lib/api.js";

const platforms = [["android", "Android"], ["ios", "iOS"], ["mobile", "Мобілки"], ["desktop", "ПК"]];

function randomDefaults() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return {
        pixel: Array.from(bytes.slice(0, 15), (byte, index) => String(index === 0 ? 1 + byte % 9 : byte % 10)).join(""),
        token: Array.from(bytes.slice(0, 24), byte => byte.toString(16).padStart(2, "0")).join(""),
    };
}

export default function CrmCampaignCreateModal({ initialGeo = "", initialCreative = "", onClose, onCreated, onError }) {
    const [form, setForm] = useState(() => ({ source: "", geo: initialGeo.toUpperCase(), domain: "", creative: initialCreative, prelander: "0", ...randomDefaults(), preset: "", fallback_preset: "", filters_on: false, rules: [] }));
    const [options, setOptions] = useState({ geos: [], domains: [], sources: [] });
    const [geoOptions, setGeoOptions] = useState({ presets: [], prelanders: [] });
    const [loading, setLoading] = useState(true);
    const [geoLoading, setGeoLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
    useEffect(() => {
        let active = true;
        unwrap(window.adsBot.getCrmCampaignForm()).then(data => {
            if (!active) return;
            setOptions(data);
            setForm(current => ({ ...current, source: data.sources[0]?.id ?? "", geo: data.geos.some(g => g.id === current.geo) ? current.geo : "" }));
        }).catch(error => { if (active) onError?.({ ...errorDetails(error), title: "Не вдалося завантажити форму CRM" }); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        let active = true;
        if (!form.geo) { setGeoOptions({ presets: [], prelanders: [] }); return () => { active = false; }; }
        setGeoLoading(true);
        unwrap(window.adsBot.getCrmCampaignGeoOptions(form.geo)).then(data => {
            if (!active) return;
            setGeoOptions(data);
            setForm(current => ({ ...current, preset: "", prelander: "0", fallback_preset: String(data.ai_top_id || ""), rules: [] }));
        }).catch(error => { if (active) { setGeoOptions({ presets: [], prelanders: [] }); onError?.({ ...errorDetails(error), title: "Не вдалося завантажити потоки CRM" }); } })
            .finally(() => { if (active) setGeoLoading(false); });
        return () => { active = false; };
    }, [form.geo]);
    const submit = async event => {
        event.preventDefault(); setSaving(true);
        try { await unwrap(window.adsBot.createCrmCampaign({ ...form, token: source?.needsToken ? form.token : "" })); onCreated(); }
        catch (error) { onError?.({ ...errorDetails(error), title: "Не вдалося створити кампанію CRM" }); }
        finally { setSaving(false); }
    };
    const source = options.sources.find(item => item.id === form.source);
    const presetOptions = <><option value="">— оберіть потік —</option>{geoOptions.presets.map(item => <option key={item.id} value={item.id}>{item.name} ({Array.isArray(item.offers) ? item.offers.length : item.offers ?? 0} оф.)</option>)}</>;
    return <div className="stream-editor-overlay keitaro-campaign-overlay" onMouseDown={onClose}>
        <form className="keitaro-campaign-editor crm-campaign-editor" onMouseDown={event => event.stopPropagation()} onSubmit={submit}>
            <header className="crm-campaign-head"><h2>Нова кампанія</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Закрити"><X size={17} /></button></header>
            <div className="crm-campaign-body">
                {loading ? <p>Завантажуємо форму…</p> : <>
                    <section className="crm-campaign-section"><h3><span>01</span> Джерело трафіку</h3><div className="crm-source-list">{options.sources.map(item => <button type="button" key={item.id} className={`crm-source ${form.source === item.id ? "active" : ""}`} aria-pressed={form.source === item.id} onClick={() => change("source", item.id)}><span className="crm-source-icon">f</span>{item.name.replace(/^f\s+/, "")}{form.source === item.id && <span className="crm-source-check">✓</span>}</button>)}</div></section>
                    <section className="crm-campaign-section"><h3><span>02</span> Основні налаштування</h3><div className="crm-campaign-grid">
                    <label className="field"><span>Гео</span><select required value={form.geo} onChange={event => change("geo", event.target.value)}><option value="">— оберіть гео —</option>{options.geos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="field"><span>Домен</span><select required value={form.domain} onChange={event => change("domain", event.target.value)}><option value="">— оберіть домен —</option>{options.domains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="field"><span>Тег креативу</span><input required placeholder="напр. W1_S, AI-16G, AI-4W-2" value={form.creative} onChange={event => change("creative", event.target.value)} /></label>
                    <label className="field"><span>Преленд (опційно)</span><select value={form.prelander} disabled={geoLoading} onChange={event => change("prelander", event.target.value)}><option value="0">Без преленда (прямо на офер)</option>{geoOptions.prelanders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    </div></section>
                    <section className="crm-campaign-section"><h3><span>03</span> Відстеження</h3><div className="crm-campaign-grid">
                    <label className="field"><span>Піксель</span><input required value={form.pixel} onChange={event => change("pixel", event.target.value)} /></label>
                    {source?.needsToken && <label className="field"><span>Токен (CAPI)</span><input required type="text" value={form.token} onChange={event => change("token", event.target.value)} /></label>}
                    </div></section>
                    <section className="crm-campaign-section"><div className="crm-flow-heading"><h3><span>04</span> Потоки та фільтри</h3>
                    <label className="crm-filter-toggle"><span>Увімкнути фільтри</span><input type="checkbox" checked={form.filters_on} onChange={event => change("filters_on", event.target.checked)} /><span className="crm-toggle-track" /></label></div>
                    {!form.filters_on ? <label className="field"><span>Основний потік</span><select required disabled={geoLoading || !form.geo} value={form.preset} onChange={event => change("preset", event.target.value)}>{presetOptions}</select></label> : <>
                        {form.rules.map((rule, index) => <div key={index} className="resource-select-row">
                            <select aria-label={`Пристрій ${index + 1}`} value={rule.platform} onChange={event => change("rules", form.rules.map((item, i) => i === index ? { ...item, platform: event.target.value } : item))}>{platforms.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                            <select aria-label={`Потік ${index + 1}`} required value={rule.preset} onChange={event => change("rules", form.rules.map((item, i) => i === index ? { ...item, preset: event.target.value } : item))}>{presetOptions}</select>
                            <button type="button" className="icon-button" aria-label="Видалити правило" onClick={() => change("rules", form.rules.filter((_, i) => i !== index))}><X size={16} /></button>
                        </div>)}
                        <button type="button" className="secondary-button" onClick={() => change("rules", [...form.rules, { platform: "android", preset: "" }])}><Plus size={15} /> Додати правило</button>
                        <label className="field"><span>Потік для інших пристроїв</span><select required value={form.fallback_preset} onChange={event => change("fallback_preset", event.target.value)}>{presetOptions}</select></label>
                    </>}</section>
                    <p className="crm-campaign-hint">Потоки (готові набори оферів) налаштовуються у вкладці «Потоки». Зміни в потоці одразу застосовуються до всіх кампаній, що його використовують.</p>
                </>}
            </div>
            <footer className="crm-campaign-foot"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Скасувати</button><button type="submit" className="primary-button crm-submit" disabled={loading || geoLoading || saving}>{saving ? "Створюємо…" : "Створити кампанію"}</button></footer>
        </form>
    </div>;
}
