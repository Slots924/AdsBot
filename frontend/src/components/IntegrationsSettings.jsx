import { useEffect, useState } from "react";
import { errorDetails, unwrap } from "../lib/api.js";

export default function IntegrationsSettings({ onError, showToast }) {
    const [settings, setSettings] = useState(null);
    const [apiKey, setApiKey] = useState("");
    const [removeApiKey, setRemoveApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        unwrap(window.adsBot.getMyrahaMonsterSettings()).then((value) => {
            if (active) setSettings(value);
        }).catch((error) => {
            if (active) { setFailed(true); onError?.(errorDetails(error)); }
        });
        return () => { active = false; };
    }, []);
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const result = await unwrap(window.adsBot.saveMyrahaMonsterSettings({ baseUrl: settings.baseUrl, apiKey, removeApiKey }));
            setSettings(result);
            setApiKey("");
            setRemoveApiKey(false);
            showToast?.("Налаштування MyrahaMonster збережено", "success");
        } catch (error) { onError?.(errorDetails(error)); }
        finally { setSaving(false); }
    };
    if (failed) return <p>Не вдалося завантажити налаштування інтеграцій. Відкрийте вкладку повторно.</p>;
    if (!settings) return <p>Завантажуємо інтеграції…</p>;
    return <form className="scale-setting" onSubmit={save}>
        <h3>MyrahaMonster</h3>
        <p>Автоприховування нових коментарів на фанпейджах. Вимкнення не відкриває раніше приховані коментарі.</p>
        <label className="field"><span>Адреса API</span><input type="url" required disabled={saving} value={settings.baseUrl}
            onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
        <label className="field"><span>API-ключ</span><input type="password" autoComplete="new-password" disabled={saving || removeApiKey}
            value={apiKey} placeholder={settings.hasApiKey ? "Ключ збережено. Введіть новий для заміни" : "Введіть API-ключ"}
            onChange={(event) => setApiKey(event.target.value)} /></label>
        {settings.hasApiKey && <label className="myraha-toggle"><input type="checkbox" checked={removeApiKey} disabled={saving}
            onChange={(event) => { setRemoveApiKey(event.target.checked); setApiKey(""); }} /><span>Видалити збережений API-ключ</span></label>}
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
    </form>;
}
