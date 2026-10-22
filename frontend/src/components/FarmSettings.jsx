import { farmActionLabels } from "../../../services/farming/farmSettings.js";

const fields = { count: "Кількість", posts: "Кількість постів", minSeconds: "Перегляд від, с", maxSeconds: "Перегляд до, с", upPercent: "Прокрутка вгору, %", percent: "Лайкати, %", max: "Максимальна кількість" };

export default function FarmSettings({ settings, onChange, pool, onPoolChange, onSave, busy }) {
    const set = (key, value) => onChange({ ...settings, [key]: value });
    const updateGroup = (index, patch) => onPoolChange(pool.map((item, i) => i === index ? { ...item, ...patch } : item));
    return <div className="farm-settings farm-form">
        <p>Спільні налаштування для всіх груп. Дії вибираються перед кожним запуском.</p>
        <div className="farm-fields">
            <label>Воркери<input type="number" min="1" max="5" value={settings.workers} onChange={(e) => set("workers", Number(e.target.value))} /></label>
            <label>Таймаут акаунта, с<input type="number" min="1" max="86400" value={settings.timeoutSeconds} onChange={(e) => set("timeoutSeconds", Number(e.target.value))} /></label>
            <label className="farm-check"><input type="checkbox" checked={settings.disableImages} onChange={(e) => set("disableImages", e.target.checked)} />Вимкнути картинки</label>
            <label className="farm-check"><input type="checkbox" checked={settings.headless} onChange={(e) => set("headless", e.target.checked)} />Безголовий режим</label>
        </div>
        {Object.entries(settings.actions).map(([key, action]) => <fieldset key={key}><legend>{farmActionLabels[key]}</legend><div className="farm-fields">
            {Object.entries(action).filter(([field]) => field !== "enabled").map(([field, value]) => <label key={field}>{fields[field]}<input type="number" min="0" max={field.toLowerCase().includes("percent") ? 100 : 10000} value={value} onChange={(e) => set("actions", { ...settings.actions, [key]: { ...action, [field]: Number(e.target.value) } })} /></label>)}
        </div></fieldset>)}
        <h3>Пул англомовних Facebook-груп</h3><p>Неперевірені кандидати вимкнені. Перевірте свіжі публікації та спам у браузері перед увімкненням.</p>
        {pool.map((group, index) => <fieldset key={group.id || index}><div className="farm-fields">
            <label>Назва<input value={group.name} onChange={(e) => updateGroup(index, { name: e.target.value })} /></label>
            <label>URL<input type="url" value={group.url} onChange={(e) => updateGroup(index, { url: e.target.value })} /></label>
            <label>Тематика<input value={group.topic} onChange={(e) => updateGroup(index, { topic: e.target.value })} /></label>
            <label className="farm-check"><input type="checkbox" checked={group.enabled} onChange={(e) => updateGroup(index, { enabled: e.target.checked })} />Увімкнена</label>
            <label>Дата перевірки<input type="date" value={group.checkedAt?.slice(0, 10) ?? ""} onChange={(e) => updateGroup(index, { checkedAt: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })} /></label>
            <button type="button" className="secondary-button" onClick={() => onPoolChange(pool.filter((_, i) => i !== index))}>Прибрати</button>
        </div></fieldset>)}
        <div className="inline-actions"><button type="button" className="secondary-button" onClick={() => onPoolChange([...pool, { id: "", name: "", url: "", topic: "", enabled: false, checkedAt: null }])}>Додати Facebook-групу</button><button type="button" className="primary-button" disabled={busy} onClick={onSave}>Зберегти налаштування</button></div>
    </div>;
}
