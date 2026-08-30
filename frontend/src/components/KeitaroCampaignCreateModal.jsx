import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RotateCcw, Search, X } from "lucide-react";

import GeoSelect from "./GeoSelect.jsx";
import SearchSelect from "./SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";

function identifierFor(geo, creativeName) {
    const code = String(geo ?? "").trim().toUpperCase();
    const creativePart = String(creativeName ?? "").split("_")[0].trim();
    return code.length >= 2 && creativePart ? `${code[0]}J${creativePart}${code[1]}` : "";
}

function defaultCampaignGroup(groups) {
    return groups.find((item) => String(item?.id ?? "") === "7")?.id
        ?? groups.find((item) => /^(myrahoi ppl|мурахоїд ппл)$/iu.test(String(item?.name ?? "")))?.id
        ?? "";
}

function Panel({ eyebrow, title, description, children, wide = false }) {
    return <section className={`keitaro-campaign-panel ${wide ? "wide" : ""}`}><header><span className="eyebrow">{eyebrow}</span><h3>{title}</h3>{description && <p>{description}</p>}</header><div className="keitaro-campaign-panel-body">{children}</div></section>;
}

function LandingPicker({ landings, value, onChange }) {
    const [query, setQuery] = useState("");
    const selected = new Set(value.map(String));
    const visible = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return [...landings].sort((a, b) => a.name.localeCompare(b.name, "uk-UA", { numeric: true, sensitivity: "base" })).filter((item) => !needle || `${item.id} ${item.name}`.toLocaleLowerCase().includes(needle));
    }, [landings, query]);
    const toggle = (id) => onChange(selected.has(String(id)) ? value.filter((item) => String(item) !== String(id)) : [...value, String(id)]);
    return <div className="campaign-landing-picker"><label className="keitaro-search campaign-landing-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук лендінгу за назвою або ID…" /></label><div className="campaign-landing-grid">{visible.length === 0 && <div className="keitaro-resource-empty">Лендінгів не знайдено.</div>}{visible.map((landing) => { const checked = selected.has(String(landing.id)); return <button type="button" className={`campaign-landing-card ${checked ? "selected" : ""}`} key={landing.id} onClick={() => toggle(landing.id)}><span><strong>{landing.name}</strong><small>ID {landing.id}</small></span><i>{checked && <Check size={16} />}</i></button>; })}</div></div>;
}

export default function KeitaroCampaignCreateModal({ onClose, onError, showToast, onCreated }) {
    const [settings, setSettings] = useState({ pixels: [], defaultPixelId: "", domainsByGeo: {} });
    const [countries, setCountries] = useState([]); const [domains, setDomains] = useState([]); const [groups, setGroups] = useState([]); const [sources, setSources] = useState([]); const [templates, setTemplates] = useState([]); const [landings, setLandings] = useState([]);
    const [loading, setLoading] = useState(true); const [creating, setCreating] = useState(false);
    const [geo, setGeo] = useState(""); const [creativeName, setCreativeName] = useState(""); const [pixelKey, setPixelKey] = useState(""); const [manualPixel, setManualPixel] = useState(false); const [pixelId, setPixelId] = useState(""); const [pixelToken, setPixelToken] = useState("");
    const [templateId, setTemplateId] = useState(""); const [groupId, setGroupId] = useState(""); const [domainId, setDomainId] = useState(""); const [landingIds, setLandingIds] = useState(["123"]); const [excludedCountries, setExcludedCountries] = useState([]); const [sourceId, setSourceId] = useState("");
    const [manualName, setManualName] = useState(false); const [name, setName] = useState(""); const [manualIdentifier, setManualIdentifier] = useState(false); const [identifier, setIdentifier] = useState("");

    useEffect(() => { Promise.all([
        unwrap(window.adsBot.getKeitaroCampaignSettings()), unwrap(window.adsBot.getKeitaroCountries()), unwrap(window.adsBot.getKeitaroDomains()), unwrap(window.adsBot.getKeitaroCampaignGroups()), unwrap(window.adsBot.getKeitaroTrafficSources()), unwrap(window.adsBot.getKeitaroStreamTemplates()), unwrap(window.adsBot.getKeitaroLandingPages({ groupId: "all" })),
    ]).then(([nextSettings, nextCountries, nextDomains, nextGroups, nextSources, nextTemplates, nextLandings]) => {
        setSettings(nextSettings); setCountries(nextCountries ?? []); setDomains(nextDomains ?? []); setGroups(nextGroups ?? []); setSources(nextSources ?? []); setTemplates([...(nextTemplates ?? [])].sort((a, b) => a.name.localeCompare(b.name, "uk-UA", { numeric: true, sensitivity: "base" }))); setLandings(nextLandings ?? []);
        setPixelKey(nextSettings.defaultPixelId || ""); setSourceId((nextSources ?? []).find((item) => item.name.toLocaleLowerCase() === "fb capi")?.id ?? ""); setGroupId(defaultCampaignGroup(nextGroups ?? []));
    }).catch((error) => onError?.({ ...errorDetails(error), title: "Не вдалося завантажити дані Keitaro" })).finally(() => setLoading(false)); }, []);
    useEffect(() => { if (groups.length) setGroupId((current) => current || defaultCampaignGroup(groups)); }, [groups]);

    const selectedPixel = settings.pixels.find((item) => item.id === pixelKey);
    const activePixelId = (manualPixel ? pixelId : selectedPixel?.pixelId ?? "").trim(); const activeToken = (manualPixel ? pixelToken : selectedPixel?.token ?? "").trim();
    const automaticName = geo && creativeName.trim() && activePixelId ? `${geo} [${creativeName.trim()}] Pixel_${activePixelId}` : "";
    const mappedDomainIds = settings.domainsByGeo?.[geo] ?? []; const mappedSet = new Set(mappedDomainIds.map(String)); const domainOptions = mappedSet.size ? domains.filter((item) => mappedSet.has(String(item.id))) : domains;
    const selectedDomain = domains.find((item) => String(item.id) === String(domainId));
    const campaignUrl = selectedDomain && identifier.trim() ? `https://${String(selectedDomain.name).replace(/^https?:\/\//i, "").replace(/\/+$/, "")}/${identifier.trim()}` : "";
    useEffect(() => { if (!manualName) setName(automaticName); }, [automaticName, manualName]);
    useEffect(() => { if (!manualIdentifier) setIdentifier(identifierFor(geo, creativeName)); }, [geo, creativeName, manualIdentifier]);
    useEffect(() => { if (!geo) { setDomainId(""); return; } setDomainId(mappedDomainIds.length === 1 ? String(mappedDomainIds[0]) : ""); setExcludedCountries((current) => current.includes(geo) ? current : [geo, ...current]); }, [geo]);

    const canCreate = !loading && !creating && name.trim() && groupId && domainId && sourceId && activePixelId && activeToken && geo && identifier.trim() && landingIds.length;
    const create = async () => { setCreating(true); try { await unwrap(window.adsBot.createKeitaroCampaign({ name: name.trim(), groupId, domainId, trafficSourceId: sourceId, pixelId: activePixelId, pixelToken: activeToken, geo, excludedCountries, landingIds, identifier: identifier.trim(), streamTemplateId: templateId || null })); showToast?.("Кампанію Keitaro створено", "success"); onCreated?.(); onClose(); } catch (error) { onError?.({ ...errorDetails(error), title: "Не вдалося створити кампанію Keitaro" }); } finally { setCreating(false); } };

    return <div className="stream-editor-overlay keitaro-campaign-overlay" role="dialog" aria-modal="true" aria-label="Створити кампанію Keitaro"><div className="keitaro-campaign-editor">
        <header className="keitaro-campaign-head"><div><span className="eyebrow">Keitaro campaign builder</span><h2>Створити кампанію</h2><p>White буде першим потоком, вибраний шаблон — другим.</p></div><button type="button" className="icon-button" aria-label="Закрити" onClick={onClose}><X size={18} /></button></header>
        <div className="keitaro-campaign-body">{loading ? <div className="campaign-loading"><LoaderCircle className="spin" size={19} /> Завантажуємо довідники Keitaro…</div> : <div className="keitaro-campaign-layout">
            <Panel eyebrow="Основне" title="Кампанія" description="GEO, креатив і місце створення кампанії."><div className="campaign-fields-grid"><label className="stream-field"><span>GEO</span><GeoSelect countries={countries} value={geo} onChange={setGeo} placeholder="Оберіть GEO" ariaLabel="GEO кампанії" /></label><label className="stream-field"><span>Назва креативу</span><input value={creativeName} onChange={(event) => setCreativeName(event.target.value)} placeholder="001_W" /></label></div><label className="stream-field"><span>Група</span><SearchSelect items={groups} value={groupId} onChange={setGroupId} placeholder="Оберіть групу" searchPlaceholder="Пошук групи…" ariaLabel="Група кампанії" /></label><label className="stream-field"><span>Домен</span><SearchSelect items={domainOptions} value={domainId} onChange={setDomainId} placeholder={mappedSet.size ? "Домен цього GEO" : "Оберіть домен вручну"} searchPlaceholder="Пошук домену…" ariaLabel="Домен" /></label><div className="campaign-identifier"><div className="campaign-generated-field"><div><strong>Ідентифікатор</strong><label><input type="checkbox" checked={manualIdentifier} onChange={(event) => setManualIdentifier(event.target.checked)} /> Вручну</label></div><span><input value={identifier} readOnly={!manualIdentifier} onChange={(event) => setIdentifier(event.target.value)} />{manualIdentifier && <button type="button" className="icon-button" onClick={() => setManualIdentifier(false)}><RotateCcw size={15} /></button>}</span></div>{campaignUrl && <a className="campaign-url" href={campaignUrl} target="_blank" rel="noreferrer">{campaignUrl}</a>}</div></Panel>
            <Panel eyebrow="Tracking" title="Піксель і CAPI" description="Типовий піксель уже вибрано з налаштувань."><label className="campaign-switch"><input type="checkbox" checked={manualPixel} onChange={(event) => setManualPixel(event.target.checked)} /><span><strong>Ввести вручну</strong><small>Замість збереженого пікселя</small></span></label>{manualPixel ? <div className="campaign-fields-grid"><label className="stream-field"><span>Pixel ID</span><input value={pixelId} onChange={(event) => setPixelId(event.target.value)} /></label><label className="stream-field"><span>Токен</span><input value={pixelToken} onChange={(event) => setPixelToken(event.target.value)} /></label></div> : <label className="stream-field"><span>Піксель</span><SearchSelect items={settings.pixels} value={pixelKey} onChange={setPixelKey} getId={(item) => item.id} getTitle={(item) => item.name} getSubtitle={(item) => item.pixelId} placeholder="Оберіть піксель" searchPlaceholder="Пошук пікселя…" ariaLabel="Піксель" /></label>}<label className="stream-field"><span>Джерело трафіку</span><SearchSelect items={sources} value={sourceId} onChange={setSourceId} placeholder="Оберіть джерело" searchPlaceholder="Пошук джерела…" ariaLabel="Джерело трафіку" /></label></Panel>
            <Panel eyebrow="Потоки" title="Маршрут кампанії" description="Шаблон необов’язковий і матиме позицію 2."><label className="stream-field"><span>Шаблон другого потоку</span><SearchSelect items={templates} value={templateId} onChange={setTemplateId} getId={(item) => item.id} getTitle={(item) => item.name} getSubtitle={(item) => `ID ${item.id}`} placeholder="Не вибрано" searchPlaceholder="Пошук шаблону…" ariaLabel="Шаблон другого потоку" /></label><label className="stream-field"><span>Країни виключити</span><SearchSelect items={countries} value={excludedCountries} onChange={setExcludedCountries} multiple getId={(item) => item.code} getTitle={(item) => `${item.code} — ${item.name}`} getSubtitle={() => ""} placeholder="Оберіть країни" searchPlaceholder="Пошук країни…" ariaLabel="Країни виключити" /></label><div className="campaign-fixed-settings"><span>Ротація за позицією</span><span>USD із <code>cost</code></span><span>IP + User-Agent + cookie</span><span>24 години · увімкнено</span></div></Panel>
            <Panel eyebrow="Автоматизація" title="Назва кампанії" description="Ручний режим можна скинути до автоматичного." wide><div className="campaign-name-grid"><div className="campaign-generated-field"><div><strong>Назва кампанії</strong><label><input type="checkbox" checked={manualName} onChange={(event) => setManualName(event.target.checked)} /> Вручну</label></div><span><input value={name} readOnly={!manualName} onChange={(event) => setName(event.target.value)} />{manualName && <button type="button" className="icon-button" onClick={() => setManualName(false)}><RotateCcw size={15} /></button>}</span></div></div></Panel>
            <Panel eyebrow="White · позиція 1" title="Лендінги" description="ID 123 вибраний за замовчуванням. Можна обрати кілька лендінгів." wide><LandingPicker landings={landings} value={landingIds} onChange={setLandingIds} /></Panel>
        </div>}</div>
        <footer className="keitaro-campaign-foot"><span>{canCreate ? "Усі обов’язкові поля заповнені" : "Заповніть обов’язкові поля та оберіть лендінг"}</span><div><button type="button" className="secondary-button" onClick={onClose}>Скасувати</button><button type="button" className="primary-button" disabled={!canCreate} onClick={create}>{creating && <LoaderCircle className="spin" size={16} />} Створити кампанію</button></div></footer>
    </div></div>;
}
