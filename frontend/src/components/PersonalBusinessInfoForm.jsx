import { useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Pencil, RefreshCw, Star, X } from "lucide-react";
import SearchSelect from "./SearchSelect.jsx";

const timezoneOptions = [
    { id: "Atlantic/Reykjavik", name: "UTC+0 · Рейк’явік, Ісландія", description: "UTC+0 протягом усього року" },
    { id: "Europe/Kiev", name: "UTC+3 · Київ, Україна", description: "Влітку UTC+3, взимку UTC+2" },
];
const defaultTimezone = timezoneOptions[0].id;
const favoriteTimezoneKey = "adsbot.personalBusiness.favoriteTimezone";

function readFavoriteTimezone() {
    try {
        const saved = window.localStorage.getItem(favoriteTimezoneKey);
        return timezoneOptions.some((option) => option.id === saved) ? saved : defaultTimezone;
    } catch { return defaultTimezone; }
}

const defaultBusinessUpdate = {
    street1: "1600 Pennsylvania Avenue NW", street2: "", city: "Washington",
    state: "DC", zip: "20500", countryCode: "US", businessName: "",
    currency: "USD", timezone: defaultTimezone,
};

const addressFields = [
    ["street1", "Вулиця, будинок", "full"],
    ["street2", "Адреса, рядок 2 · необов’язково", "full"],
    ["city", "Місто", "full"],
    ["state", "Штат, область або регіон", ""],
    ["zip", "Поштовий індекс", ""],
];

function BusinessFields({ value, onChange, busy = false, favoriteTimezone, onFavoriteTimezone }) {
    const set = (key, next) => onChange?.((current) => ({ ...current, [key]: next }));
    return <fieldset className="personal-business-form-body" disabled={busy}>
            <div className="personal-business-form-section">
                <h5>Країна або регіон для виставлення рахунків</h5>
                <label className="personal-business-field"><span>Країна або регіон · код ISO</span><input readOnly={!onChange} value={value.countryCode} maxLength={2} onChange={(event) => set("countryCode", event.target.value.toUpperCase())} /></label>
            </div>
            <div className="personal-business-form-section">
                <h5>Валюта та часовий пояс</h5>
                <div className="personal-business-form-grid">
                    <label className="personal-business-field"><span>Валюта</span><input readOnly={!onChange} value={value.currency} maxLength={3} onChange={(event) => set("currency", event.target.value.toUpperCase())} /></label>
                    {onChange ? <div className="personal-business-field personal-business-timezone">
                        <span>Часовий пояс</span>
                        <SearchSelect items={timezoneOptions} value={value.timezone} onChange={(timezone) => set("timezone", timezone)}
                            getSubtitle={(option) => option.description} ariaLabel="Часовий пояс" disabled={busy}
                            searchPlaceholder="Пошук часового поясу…"
                            renderOptionAction={(option) => <button type="button" className="icon-button personal-business-timezone-star"
                                aria-label={`За замовчуванням: ${option.name}`} aria-pressed={favoriteTimezone === option.id}
                                title="Використовувати за замовчуванням" disabled={busy} onClick={() => onFavoriteTimezone(option.id)}>
                                <Star size={17} fill={favoriteTimezone === option.id ? "currentColor" : "none"} />
                            </button>} />
                    </div> : <label className="personal-business-field"><span>Часовий пояс</span><input readOnly value={value.timezone} /></label>}
                </div>
            </div>
            <div className="personal-business-form-section">
                <h5>Бізнес-адреса</h5>
                <p>Юридична адреса, зареєстрована у відповідних державних і податкових органах.</p>
                <div className="personal-business-form-grid">
                    {addressFields.map(([key, label, width]) => <label className={`personal-business-field ${width}`} key={key}><span>{label}</span><input readOnly={!onChange} value={value[key]} onChange={(event) => set(key, event.target.value)} /></label>)}
                </div>
            </div>
    </fieldset>;
}

export default function PersonalBusinessInfoForm({ value, onCheck, onSave, busy, ready, checked, refreshError }) {
    const [draft, setDraft] = useState(null);
    const [favoriteTimezone, setFavoriteTimezone] = useState(readFavoriteTimezone);
    const chooseFavoriteTimezone = (timezone) => {
        setFavoriteTimezone(timezone);
        setDraft((current) => current ? { ...current, timezone } : current);
        try { window.localStorage.setItem(favoriteTimezoneKey, timezone); } catch {}
    };
    const canSave = draft && ready && !busy && /^[A-Z]{2}$/.test(draft.countryCode)
        && /^[A-Z]{3}$/.test(draft.currency) && ["timezone", "street1", "city", "state", "zip"]
            .every((key) => String(draft[key] ?? "").trim());
    const dismiss = () => { if (!busy) setDraft(null); };

    return <>
        <div className="personal-business-toolbar">
            <button type="button" className="secondary-button" disabled={!ready || busy} onClick={onCheck}><RefreshCw size={16} /> Перевірити бізнес-інфу</button>
            <button type="button" className="secondary-button personal-business-update-button" disabled={!ready || busy} onClick={() => setDraft({ ...defaultBusinessUpdate, timezone: favoriteTimezone })}><Pencil size={16} /> Оновити бізнес-інфу</button>
        </div>
        <div className="personal-business-form">
            <div className="personal-business-form-heading"><div><h4>Бізнес-інформація</h4><p>Поточні реквізити вибраного рекламного акаунта.</p></div></div>
            <BusinessFields value={value} />
            <div className="personal-business-form-footer" role="status"><span className={refreshError ? "personal-business-warning" : ""}>{refreshError || (checked ? "Дані отримано з вибраного РК" : "Натисніть «Перевірити бізнес-інфу», щоб отримати дані")}</span></div>
        </div>
        {draft && createPortal(<div className="overlay personal-business-editor-overlay" onMouseDown={(event) => { event.stopPropagation(); dismiss(); }}>
            <form className="modal personal-business-editor" role="dialog" aria-modal="true" aria-labelledby="business-editor-title"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}
                onSubmit={async (event) => {
                    event.preventDefault();
                    if (!canSave) return;
                    const result = await onSave(draft);
                    if (result && !result.refreshError) setDraft(null);
                }}>
                <div className="personal-business-editor-heading">
                    <div><h2 id="business-editor-title">Оновити бізнес-інфу</h2><p>Дефолтні значення вже заповнені. За потреби відредагуйте їх перед оновленням.</p></div>
                    <button type="button" className="icon-button" aria-label="Закрити редактор бізнес-інформації" disabled={busy} onClick={dismiss}><X size={18} /></button>
                </div>
                <BusinessFields value={draft} onChange={setDraft} busy={busy} favoriteTimezone={favoriteTimezone} onFavoriteTimezone={chooseFavoriteTimezone} />
                <div className="form-actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>Скасувати</button>
                    <button type="submit" className="primary-button" disabled={!canSave}>{busy ? <><LoaderCircle className="spin" size={16} /> Оновлення…</> : "Оновити інформацію"}</button>
                </div>
                {refreshError && <p className="personal-business-warning" role="status">{refreshError}</p>}
            </form>
        </div>, document.body)}
    </>;
}
