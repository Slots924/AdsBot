const addressFields = [
    ["street1", "Вулиця, будинок", "full"],
    ["street2", "Адреса, рядок 2 · необов’язково", "full"],
    ["city", "Місто", "full"],
    ["state", "Штат, область або регіон", ""],
    ["zip", "Поштовий індекс", ""],
];

export default function PersonalBusinessInfoForm({ value, onChange, onCheck, onSave, busy, ready, checked, refreshError }) {
    const set = (key, next) => onChange((current) => ({ ...current, [key]: next }));
    const canSave = ready && checked && !busy && /^[A-Z]{2}$/.test(value.countryCode)
        && /^[A-Z]{3}$/.test(value.currency) && ["timezone", "street1", "city", "state", "zip"]
        .every((key) => String(value[key] ?? "").trim());

    return <div className="personal-business-form">
        <div className="personal-business-form-heading">
            <div><span>РЕКВІЗИТИ РЕКЛАМНОГО АКАУНТА</span><h4>Бізнес-інформація</h4><p>Поля заповняться після перевірки вибраного РК.</p></div>
            <button type="button" className="secondary-button" disabled={!ready || busy} onClick={onCheck}>Перевірити бізнес-інфу</button>
        </div>
        <div className="personal-business-form-body">
            <div className="personal-business-form-section">
                <h5>Країна або регіон для виставлення рахунків</h5>
                <label className="personal-business-field"><span>Країна або регіон · код ISO</span><input value={value.countryCode} maxLength={2} placeholder="Наприклад, US" onChange={(event) => set("countryCode", event.target.value.toUpperCase())} /></label>
            </div>
            <div className="personal-business-form-section">
                <h5>Валюта та часовий пояс</h5>
                <div className="personal-business-form-grid">
                    <label className="personal-business-field"><span>Валюта</span><input value={value.currency} maxLength={3} placeholder="Наприклад, USD" onChange={(event) => set("currency", event.target.value.toUpperCase())} /></label>
                    <label className="personal-business-field"><span>Часовий пояс</span><input value={value.timezone} placeholder="Наприклад, America/Los_Angeles" onChange={(event) => set("timezone", event.target.value)} /></label>
                </div>
            </div>
            <div className="personal-business-form-section">
                <h5>Бізнес-адреса</h5>
                <p>Юридична адреса, зареєстрована у відповідних державних і податкових органах.</p>
                <div className="personal-business-form-grid">
                    {addressFields.map(([key, label, width]) => <label className={`personal-business-field ${width}`} key={key}><span>{label}</span><input value={value[key]} onChange={(event) => set(key, event.target.value)} /></label>)}
                </div>
            </div>
        </div>
        <div className="personal-business-form-footer">
            <span>{refreshError || (checked ? "Дані отримано з вибраного РК" : "Дані ще не перевірено")}</span>
            <button type="button" className="primary-button" disabled={!canSave} onClick={onSave}>Оновити інформацію</button>
        </div>
    </div>;
}
