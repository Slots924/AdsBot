import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    Copy,
    FilePenLine,
    LayoutTemplate,
    LoaderCircle,
    Plus,
    Search,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const placementOptions = [
    { platform: "facebook", value: "feed", label: "Facebook Feed" },
    { platform: "facebook", value: "story", label: "Facebook Stories" },
    { platform: "facebook", value: "reels", label: "Facebook Reels" },
    { platform: "instagram", value: "stream", label: "Instagram Feed" },
    { platform: "instagram", value: "story", label: "Instagram Stories" },
    { platform: "instagram", value: "reels", label: "Instagram Reels" },
];
const ageOptions = Array.from({ length: 48 }, (_, index) => index + 18);


function emptyDraft() {
    return {
        name: "",
        pixel: "",
        countryCodes: [],
        gender: "any",
        ageMin: 18,
        ageMax: 65,
        devicePlatforms: [],
        operatingSystems: [],
        placements: { facebook: ["feed"], instagram: [] },
        utm: "",
        shareAdSetBudget: false,
        disableCreativeEnhancements: true,
        dsaBeneficiary: "",
        dsaPayorSameAsBeneficiary: true,
        dsaPayor: "",
    };
}


function formatUpdatedAt(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("uk-UA", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(value));
}


function cloneTemplate(template) {
    return {
        ...emptyDraft(),
        ...template,
        countryCodes: [...(template.countryCodes ?? [])],
        devicePlatforms: [...(template.devicePlatforms ?? [])],
        operatingSystems: [...(template.operatingSystems ?? [])],
        placements: {
            facebook: [...(template.placements?.facebook ?? [])],
            instagram: [...(template.placements?.instagram ?? [])],
        },
    };
}


export default function TemplatesTab({ onError, showToast }) {
    const [templates, setTemplates] = useState([]);
    const [countries, setCountries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [editor, setEditor] = useState(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [countrySearch, setCountrySearch] = useState("");
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [loadedTemplates, loadedCountries] = await Promise.all([
                unwrap(window.adsBot.getTemplates()),
                unwrap(window.adsBot.getCountries()),
            ]);
            setTemplates(loadedTemplates);
            setCountries(loadedCountries);
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити шаблони",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const filteredCountries = useMemo(() => {
        const query = countrySearch.trim().toLowerCase();
        return countries.filter((country) => (
            !query
            || country.code.toLowerCase().includes(query)
            || country.name.toLowerCase().includes(query)
            || country.aliases?.some((alias) => (
                alias.toLowerCase().includes(query)
            ))
        )).slice(0, 80);
    }, [countries, countrySearch]);

    const openCreate = () => {
        setDraft(emptyDraft());
        setCountrySearch("");
        setEditor({ mode: "create" });
    };

    const openEdit = (template) => {
        setDraft(cloneTemplate(template));
        setCountrySearch("");
        setEditor({ mode: "edit", id: template.id });
    };

    const toggleCountry = (code) => {
        setDraft((current) => ({
            ...current,
            countryCodes: current.countryCodes.includes(code)
                ? current.countryCodes.filter((item) => item !== code)
                : [...current.countryCodes, code],
        }));
    };

    const togglePlacement = (platform, placement) => {
        setDraft((current) => {
            const selected = current.placements[platform] ?? [];
            return {
                ...current,
                placements: {
                    ...current.placements,
                    [platform]: selected.includes(placement)
                        ? selected.filter((item) => item !== placement)
                        : [...selected, placement],
                },
            };
        });
    };

    const deviceMode = draft.devicePlatforms.length === 1
        ? draft.devicePlatforms[0]
        : "all";
    const operatingSystemMode = draft.operatingSystems.length === 1
        ? draft.operatingSystems[0]
        : "all";

    const changeDeviceMode = (value) => {
        setDraft((current) => ({
            ...current,
            devicePlatforms: value === "all" ? [] : [value],
            operatingSystems: value === "mobile"
                ? current.operatingSystems
                : [],
        }));
    };

    const changeOperatingSystem = (value) => {
        setDraft((current) => ({
            ...current,
            devicePlatforms: ["mobile"],
            operatingSystems: value === "all" ? [] : [value],
        }));
    };

    const save = async (event) => {
        event.preventDefault();
        if (!draft.name.trim() || saving) return;
        setSaving(true);
        try {
            const saved = editor.mode === "edit"
                ? await unwrap(window.adsBot.updateTemplate(editor.id, draft))
                : await unwrap(window.adsBot.createTemplate(draft));
            setTemplates((current) => editor.mode === "edit"
                ? current.map((item) => item.id === saved.id ? saved : item)
                : [...current, saved]);
            setEditor(null);
            showToast(
                editor.mode === "edit"
                    ? `Шаблон ID ${saved.id} оновлено`
                    : `Створено шаблон ID ${saved.id}`,
                "success"
            );
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося зберегти шаблон",
            });
        } finally {
            setSaving(false);
        }
    };

    const duplicate = async (event, template) => {
        event.stopPropagation();
        setBusyId(template.id);
        try {
            const copy = await unwrap(window.adsBot.duplicateTemplate(template.id));
            setTemplates((current) => [...current, copy]);
            showToast(`Створено копію з ID ${copy.id}`, "success");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося дублювати шаблон" });
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (event, template) => {
        event.stopPropagation();
        if (!window.confirm(`Видалити шаблон «${template.name}» (ID ${template.id})?`)) return;
        setBusyId(template.id);
        try {
            await unwrap(window.adsBot.deleteTemplate(template.id));
            setTemplates((current) => current.filter((item) => item.id !== template.id));
            showToast(`Шаблон ID ${template.id} видалено`, "success");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося видалити шаблон" });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <motion.section className="tab-content templates-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="page-heading split">
                <div>
                    <span className="eyebrow">Campaign presets</span>
                    <h1>Шаблони кампаній</h1>
                    <p>Локальні налаштування website lead-кампаній.</p>
                </div>
                <button className="primary-button templates-create" onClick={openCreate}>
                    <Plus size={17} /> Створити шаблон
                </button>
            </div>

            <div className="templates-table-card">
                <div className="templates-table-head templates-grid">
                    <span>ID</span><span>Назва</span><span>Pixel</span>
                    <span>Аудиторія</span><span>Оновлено</span><span>Дії</span>
                </div>
                {loading && <div className="templates-empty"><LoaderCircle className="spin" size={23} /> Завантажуємо шаблони…</div>}
                {!loading && templates.length === 0 && (
                    <div className="templates-empty">
                        <LayoutTemplate size={31} />
                        <strong>Шаблонів ще немає</strong>
                        <span>Створіть перший шаблон рекламної кампанії.</span>
                    </div>
                )}
                {!loading && templates.map((template) => (
                    <div key={template.id} className="template-row templates-grid" role="button" tabIndex={0} onClick={() => openEdit(template)} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openEdit(template);
                    }}>
                        <span className="template-id"><i className="status-dot active" />{template.id}</span>
                        <strong>{template.name}</strong>
                        <span className={template.pixel ? "" : "muted-value"}>{template.pixel || "Не вказано"}</span>
                        <span className={template.countryCodes?.length ? "" : "muted-value"}>
                            {template.countryCodes?.length
                                ? `${template.countryCodes.join(", ")} · ${template.ageMin}–${template.ageMax === 65 ? "65+" : template.ageMax}`
                                : "Потрібно доповнити"}
                        </span>
                        <time>{formatUpdatedAt(template.updatedAt)}</time>
                        <span className="template-actions">
                            <button className="icon-button" title="Дублювати" disabled={busyId === template.id} onClick={(event) => duplicate(event, template)}>
                                {busyId === template.id ? <LoaderCircle className="spin" size={15} /> : <Copy size={15} />}
                            </button>
                            <button className="icon-button danger" title="Видалити" disabled={busyId === template.id} onClick={(event) => remove(event, template)}><Trash2 size={15} /></button>
                        </span>
                    </div>
                ))}
            </div>

            {editor && (
                <div className="overlay template-editor-overlay" onMouseDown={() => !saving && setEditor(null)}>
                    <motion.form className="modal template-editor expanded" initial={{ opacity: 0, y: 20, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
                        <button className="modal-close" type="button" disabled={saving} onClick={() => setEditor(null)}><X size={17} /></button>
                        <div className="modal-icon template-icon"><FilePenLine /></div>
                        <span className="eyebrow">{editor.mode === "edit" ? `Template ID ${editor.id}` : "New template"}</span>
                        <h2>{editor.mode === "edit" ? "Редагувати шаблон" : "Новий шаблон"}</h2>

                        <div className="template-editor-scroll">
                            <div className="template-editor-fields two-columns">
                                <label className="field"><span>Назва</span><input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Наприклад, AT Slot" /></label>
                                <label className="field"><span>Pixel ID</span><input value={draft.pixel} onChange={(event) => setDraft((current) => ({ ...current, pixel: event.target.value }))} placeholder="Pixel ID або назва" /></label>
                            </div>

                            <section className="template-form-section">
                                <header><strong>Аудиторія</strong><small>Advantage audience вимкнено</small></header>
                                <label className="field country-picker"><span>Країни</span><div className="search-input"><Search size={15} /><input value={countrySearch} onChange={(event) => setCountrySearch(event.target.value)} placeholder="Hungary, HU, United States…" /></div></label>
                                <div className="country-options">
                                    {filteredCountries.map((country) => (
                                        <label key={country.code} className={draft.countryCodes.includes(country.code) ? "selected" : ""}>
                                            <input type="checkbox" checked={draft.countryCodes.includes(country.code)} onChange={() => toggleCountry(country.code)} />
                                            <b>{country.code}</b><span>{country.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="selected-countries">
                                    {draft.countryCodes.map((code) => <button type="button" key={code} onClick={() => toggleCountry(code)}>{code} <X size={11} /></button>)}
                                </div>
                                <div className="template-editor-fields three-columns">
                                    <label className="field"><span>Стать</span><select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value }))}><option value="any">Будь-яка</option><option value="male">Чоловіча</option><option value="female">Жіноча</option></select></label>
                                    <label className="field"><span>Вік від</span><select value={draft.ageMin} onChange={(event) => setDraft((current) => { const ageMin = Number(event.target.value); return { ...current, ageMin, ageMax: Math.max(ageMin, current.ageMax) }; })}>{ageOptions.map((age) => <option key={age} value={age}>{age}</option>)}</select></label>
                                    <label className="field"><span>Вік до</span><select value={draft.ageMax} onChange={(event) => setDraft((current) => ({ ...current, ageMax: Number(event.target.value) }))}>{ageOptions.filter((age) => age >= draft.ageMin).map((age) => <option key={age} value={age}>{age === 65 ? "65+" : age}</option>)}</select></label>
                                </div>
                                <small className="field-hint">65+ означає, що люди старше 65 років не відсікаються.</small>
                            </section>

                            <section className="template-form-section">
                                <header><strong>Ручні placements</strong><small>За замовчуванням Facebook Feed</small></header>
                                <div className="placement-grid">
                                    {placementOptions.map((option) => <label key={`${option.platform}-${option.value}`} className="checkbox-line compact"><input type="checkbox" checked={draft.placements[option.platform]?.includes(option.value)} onChange={() => togglePlacement(option.platform, option.value)} /><span>{option.label}</span></label>)}
                                </div>
                                <div className="template-editor-fields two-columns">
                                    <label className="field"><span>Пристрої</span><select value={deviceMode} onChange={(event) => changeDeviceMode(event.target.value)}><option value="all">Усі пристрої</option><option value="mobile">Лише мобільні</option><option value="desktop">Лише комп’ютери</option></select></label>
                                    <label className="field"><span>Операційна система</span><select value={operatingSystemMode} disabled={deviceMode !== "mobile"} onChange={(event) => changeOperatingSystem(event.target.value)}><option value="all">Усі мобільні ОС</option><option value="Android">Android</option><option value="iOS">iOS</option></select></label>
                                </div>
                                <small className="field-hint">Вибір ОС доступний лише для мобільних пристроїв.</small>
                            </section>

                            <section className="template-form-section dsa-section">
                                <header><strong>Прозорість реклами в Європі</strong><small>DSA beneficiary / payor</small></header>
                                <div className="notice info">
                                    Вказуйте справжні назви особи або організації, яка отримує вигоду від реклами та оплачує її. Програма не генерує ці назви автоматично.
                                </div>
                                <div className="template-editor-fields two-columns">
                                    <label className="field">
                                        <span>Бенефіціар</span>
                                        <input
                                            value={draft.dsaBeneficiary}
                                            onChange={(event) => setDraft((current) => ({
                                                ...current,
                                                dsaBeneficiary: event.target.value,
                                            }))}
                                            placeholder="Юридична назва або ім’я"
                                        />
                                    </label>
                                    <label className="field">
                                        <span>Платник</span>
                                        <input
                                            disabled={draft.dsaPayorSameAsBeneficiary}
                                            value={draft.dsaPayorSameAsBeneficiary
                                                ? draft.dsaBeneficiary
                                                : draft.dsaPayor}
                                            onChange={(event) => setDraft((current) => ({
                                                ...current,
                                                dsaPayor: event.target.value,
                                            }))}
                                            placeholder="Юридична назва або ім’я"
                                        />
                                    </label>
                                </div>
                                <label className="checkbox-line">
                                    <input
                                        type="checkbox"
                                        checked={draft.dsaPayorSameAsBeneficiary}
                                        onChange={(event) => setDraft((current) => ({
                                            ...current,
                                            dsaPayorSameAsBeneficiary:
                                                event.target.checked,
                                        }))}
                                    />
                                    <span><strong>Платник збігається з бенефіціаром</strong><small>Увімкнено за замовчуванням.</small></span>
                                </label>
                            </section>

                            <section className="template-form-section">
                                <label className="field"><span>UTM / URL tags</span><textarea rows="4" value={draft.utm} onChange={(event) => setDraft((current) => ({ ...current, utm: event.target.value }))} placeholder="utm_campaign={{campaign.name}}&utm_source={{site_source_name}}" /></label>
                                <label className="checkbox-line"><input type="checkbox" checked={draft.shareAdSetBudget} onChange={(event) => setDraft((current) => ({ ...current, shareAdSetBudget: event.target.checked }))} /><span><strong>Дозволити Meta розподіляти бюджет між ad sets</strong><small>Бюджети все одно задаються на рівні ad set.</small></span></label>
                                <div className="notice info">Музика, Standard Enhancements, Advantage+ Creative, автоматичний текст та image/video-покращення примусово вимкнені.</div>
                            </section>
                        </div>

                        <div className="form-actions">
                            <button className="secondary-button" type="button" disabled={saving} onClick={() => setEditor(null)}>Скасувати</button>
                            <button className="primary-button" type="submit" disabled={!draft.name.trim() || saving}>{saving && <LoaderCircle className="spin" size={16} />}{editor.mode === "edit" ? "Зберегти зміни" : "Створити шаблон"}</button>
                        </div>
                    </motion.form>
                </div>
            )}
        </motion.section>
    );
}
