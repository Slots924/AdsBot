import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { defaultAfpUserAgent } from "../../../facebook/api/accountCredentials.js";
import { systemUserAgents } from "../lib/systemUserAgents.js";
import { errorDetails, unwrap } from "../lib/api.js";

export default function SpendServerSettings({ onError = () => {}, showToast }) {
    const [values, setValues] = useState(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const [visible, setVisible] = useState({});
    const secretField = (key, label) => <label className="field"><span>{label}</span>
        <div style={{ display: "flex", gap: 8 }}>
            <input type={visible[key] ? "text" : "password"} autoComplete="off" value={values[key]} onChange={update(key)} disabled={saving} />
            <button type="button" className="icon-button" aria-label={`${visible[key] ? "Приховати" : "Показати"} ${key === "clientKey" ? "Client Key" : "cookies"}`}
                aria-pressed={Boolean(visible[key])} onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}>
                {visible[key] ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </label>;
    useEffect(() => {
        let active = true;
        unwrap(window.adsBot.getSpendServerSettings()).then((data) => {
            if (active) setValues(data);
        }).catch((error) => {
            if (active) { setFailed(true); onError({ ...errorDetails(error), title: "Налаштування Spend Server" }); }
        });
        return () => { active = false; };
    }, []);
    const update = (key) => (event) => setValues({ ...values, [key]: event.target.value });
    const save = async () => {
        setSaving(true);
        try {
            setValues(await unwrap(window.adsBot.saveSpendServerSettings(values)));
            setVisible({});
            showToast?.("Налаштування Spend Server збережено");
        } catch (error) { onError({ ...errorDetails(error), title: "Не вдалося зберегти Spend Server" }); }
        finally { setSaving(false); }
    };
    if (failed) return <p>Не вдалося завантажити налаштування Spend Server.</p>;
    if (!values) return <p>Завантажуємо налаштування Spend Server…</p>;
    return <section className="scale-setting">
        <h3>Spend Server</h3>
        <p>Після кожної успішної перевірки AFP-токена надсилаємо токен клієнта, cookies та User-Agent із цих налаштувань.</p>
        <label className="field"><span>Адреса сервера (HTTPS)</span><input value={values.url} onChange={update("url")} placeholder="https://spend.example.com" disabled={saving} /></label>
        {secretField("clientKey", "Client Key")}
        <label className="field"><span>User-Agent</span><select value={values.userAgent} onChange={update("userAgent")} disabled={saving}>
            <option value={defaultAfpUserAgent}>Стандартний · Windows</option>
            {systemUserAgents.filter(([, value]) => value !== defaultAfpUserAgent).map(([label, value]) => <option key={value} value={value}>{label}</option>)}
            {values.userAgent !== defaultAfpUserAgent && !systemUserAgents.some(([, value]) => value === values.userAgent) && <option value={values.userAgent}>Власний User-Agent</option>}
        </select></label>
        {secretField("cookies", "Cookies Facebook (початково з API-клієнта 053)")}
        <p>Cookies мають містити c_user та xs. Вони спільні для всіх відправок AFP-токенів.</p>
        <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
    </section>;
}
