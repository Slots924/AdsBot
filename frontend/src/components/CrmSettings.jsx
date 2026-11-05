import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { errorDetails, unwrap } from "../lib/api.js";

const empty = { login: "", password: "", session: "", token: "", cookies: "", userAgent: "" };

export default function CrmSettings({ onError = () => {}, showToast }) {
    const [values, setValues] = useState(empty);
    const [saved, setSaved] = useState(empty);
    const [visible, setVisible] = useState({});
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        unwrap(window.adsBot.getCrmSettings()).then((data) => {
            if (active) { setValues(data); setSaved(data); }
        }).catch((error) => {
            if (active) { setLoadFailed(true); onError({ ...errorDetails(error), title: "Не вдалося завантажити налаштування CRM" }); }
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const authFields = ["session", "token", "cookies"];
            const changedAuthFields = authFields.filter((key) => values[key] !== saved[key]);
            const next = { ...values };
            if (changedAuthFields.length === 1) {
                for (const key of authFields) if (key !== changedAuthFields[0]) next[key] = "";
            }
            const result = await unwrap(window.adsBot.saveCrmSettings(next));
            setValues(result); setSaved(result); setEditing(false); setVisible({});
            showToast?.("Налаштування CRM збережено");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося зберегти налаштування CRM" });
        } finally { setSaving(false); }
    };

    if (loading) return <p>Завантажуємо налаштування CRM…</p>;
    if (loadFailed) return <p>Не вдалося завантажити налаштування CRM.</p>;
    return <section className="scale-setting">
        <h3>CRM</h3>
        <p>Усі поля необов'язкові.</p>
        <label className="field"><span>User-Agent</span>
            <input aria-label="User-Agent" type="text" value={values.userAgent} disabled={!editing || saving}
                onChange={(event) => setValues({ ...values, userAgent: event.target.value })} />
        </label>
        {[["login", "Логін"], ["password", "Пароль"], ["session", "Сесія"], ["token", "Токен"], ["cookies", "Cookies"]].map(([key, label]) =>
            <label className="field" key={key}>
                <span>{label}</span>
                <div style={{ display: "flex", gap: 8 }}>
                    <input aria-label={label} type={visible[key] ? "text" : "password"} value={values[key]} disabled={!editing || saving}
                        autoComplete="off" onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
                    <button type="button" className="icon-button" aria-label={`${visible[key] ? "Приховати" : "Показати"} ${label.toLowerCase()}`}
                        onClick={() => setVisible({ ...visible, [key]: !visible[key] })}>
                        {visible[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </label>)}
        {editing ? <div className="form-actions">
            <button type="button" className="secondary-button" disabled={saving} onClick={() => { setValues(saved); setEditing(false); setVisible({}); }}>Скасувати</button>
            <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
        </div> : <button type="button" className="secondary-button" onClick={() => setEditing(true)}>Змінити</button>}
    </section>;
}
