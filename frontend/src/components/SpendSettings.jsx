import { useEffect, useState } from "react";

import { errorDetails, unwrap } from "../lib/api.js";


const emptySettings = {
    startDate: "2026-09-01",
    commissionPercent: 10,
    collectEnabled: false,
    collectIntervalMinutes: 60,
    exportEnabled: false,
    exportIntervalMinutes: 60,
    reconciliationDays: 5,
    keitaroGroupIds: [],
};


export default function SpendSettings({ onError = () => {}, showToast }) {
    const [settings, setSettings] = useState(emptySettings);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            unwrap(window.adsBot.getSpendSettings()),
            unwrap(window.adsBot.getKeitaroCampaignGroups()).catch(() => []),
        ]).then(([loaded, loadedGroups]) => {
            if (!cancelled) {
                setSettings({ ...emptySettings, ...loaded });
                setGroups(loadedGroups ?? []);
            }
        }).catch((error) => {
            if (!cancelled) onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити налаштування спенду",
            });
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    const change = (field, value) => setSettings((current) => ({
        ...current,
        [field]: value,
    }));
    const toggleGroup = (id) => change(
        "keitaroGroupIds",
        settings.keitaroGroupIds.includes(String(id))
            ? settings.keitaroGroupIds.filter((item) => item !== String(id))
            : [...settings.keitaroGroupIds, String(id)]
    );
    const save = async () => {
        setSaving(true);
        try {
            setSettings(await unwrap(window.adsBot.saveSpendSettings(settings)));
            showToast?.("Налаштування спенду збережено", "success");
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося зберегти налаштування спенду",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p>Завантажуємо налаштування спенду…</p>;
    return (
        <>
            <p>Збір із Meta та передача у Keitaro запускаються окремими фоновими задачами.</p>
            <section className="scale-setting spend-settings-grid">
                <label className="field">
                    <span>Початок відрахунку</span>
                    <input
                        type="date"
                        value={settings.startDate}
                        onChange={(event) => change("startDate", event.target.value)}
                    />
                </label>
                <label className="field">
                    <span>Комісія до спенду, %</span>
                    <input
                        aria-label="Комісія до спенду, %"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={settings.commissionPercent}
                        onChange={(event) => change("commissionPercent", Number(event.target.value))}
                    />
                    <small>Перед відправкою в Keitaro до чистого спенду Meta додається цей відсоток.</small>
                </label>
                <label className="checkbox-line">
                    <input
                        type="checkbox"
                        checked={settings.collectEnabled}
                        onChange={(event) => change("collectEnabled", event.target.checked)}
                    />
                    <span><strong>Автоматично збирати з Meta</strong><small>Пропущене оновлення запуститься після відкриття програми.</small></span>
                </label>
                <label className="field">
                    <span>Інтервал збору, хвилин</span>
                    <input
                        type="number"
                        min="15"
                        max="1440"
                        step="15"
                        value={settings.collectIntervalMinutes}
                        onChange={(event) => change("collectIntervalMinutes", Number(event.target.value))}
                    />
                </label>
                <label className="checkbox-line">
                    <input
                        type="checkbox"
                        checked={settings.exportEnabled}
                        onChange={(event) => change("exportEnabled", event.target.checked)}
                    />
                    <span><strong>Автоматично передавати в Keitaro</strong><small>Рекомендований інтервал — одна година.</small></span>
                </label>
                <label className="field">
                    <span>Інтервал передачі, хвилин</span>
                    <input
                        type="number"
                        min="15"
                        max="1440"
                        step="15"
                        value={settings.exportIntervalMinutes}
                        onChange={(event) => change("exportIntervalMinutes", Number(event.target.value))}
                    />
                </label>
                <label className="field">
                    <span>Повторно перевіряти днів</span>
                    <input
                        type="number"
                        min="1"
                        max="30"
                        value={settings.reconciliationDays}
                        onChange={(event) => change("reconciliationDays", Number(event.target.value))}
                    />
                </label>
            </section>
            <section className="scale-setting">
                <div className="scale-setting-heading"><span>Групи кампаній Keitaro</span></div>
                <small className="settings-hint">Якщо нічого не вибрано, пошук відповідностей виконується по всіх групах.</small>
                <div className="keitaro-groups spend-group-list">
                    {groups.map((group) => (
                        <label key={group.id}>
                            <input
                                type="checkbox"
                                checked={settings.keitaroGroupIds.includes(String(group.id))}
                                onChange={() => toggleGroup(group.id)}
                            />
                            <span>{group.name}</span><small>ID {group.id}</small>
                        </label>
                    ))}
                    {groups.length === 0 && <small>Групи Keitaro не завантажені.</small>}
                </div>
            </section>
            <button className="primary-button" disabled={saving} onClick={save}>
                {saving ? "Зберігаємо…" : "Зберегти налаштування спенду"}
            </button>
        </>
    );
}
