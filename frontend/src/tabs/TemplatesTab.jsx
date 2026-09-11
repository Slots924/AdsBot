import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    Bot,
    Copy,
    FilePenLine,
    LayoutTemplate,
    LoaderCircle,
    Plus,
    Search,
    Smartphone,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import GeoSelect from "../components/GeoSelect.jsx";


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
        countryCodes: [],
        locales: [],
        gender: "any",
        ageMin: 18,
        ageMax: 65,
        devicePlatforms: [],
        operatingSystems: [],
        placements: { facebook: ["feed"], instagram: [] },
        shareAdSetBudget: false,
        disableCreativeEnhancements: true,
        disableMultiAdvertiserAds: true,
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


function audienceText(template) {
    if (!template.countryCodes?.length) return "Потрібно доповнити";
    return `${template.countryCodes.join(", ")} · ${template.locales?.length ? `${template.locales.length} мов` : "мова не вибрана"} · ${template.ageMin}–${template.ageMax === 65 ? "65+" : template.ageMax}`;
}


function templateSearchText(template) {
    return [
        template.id,
        template.name,
        ...(template.countryCodes ?? []),
        audienceText(template),
    ].join(" ").toLocaleLowerCase();
}


function compareTemplates(left, right, column, direction) {
    const sign = direction === "desc" ? -1 : 1;
    if (column === "id") {
        return sign * (Number(left.id) - Number(right.id));
    }
    if (column === "updatedAt") {
        return sign * ((Date.parse(left.updatedAt) || 0) - (Date.parse(right.updatedAt) || 0));
    }
    if (column === "countries") {
        return sign * String(left.countryCodes?.join(", ") ?? "").localeCompare(
            String(right.countryCodes?.join(", ") ?? ""),
            "uk",
            { sensitivity: "base" }
        );
    }
    if (column === "audience") {
        return sign * audienceText(left).localeCompare(audienceText(right), "uk", { sensitivity: "base" });
    }
    return sign * String(left.name ?? "").localeCompare(String(right.name ?? ""), "uk", {
        numeric: true,
        sensitivity: "base",
    });
}


function cloneTemplate(template) {
    return {
        ...emptyDraft(),
        ...template,
        countryCodes: [...(template.countryCodes ?? [])],
        locales: [...(template.locales ?? [])],
        devicePlatforms: [...(template.devicePlatforms ?? [])],
        operatingSystems: [...(template.operatingSystems ?? [])],
        placements: {
            facebook: [...(template.placements?.facebook ?? [])],
            instagram: [...(template.placements?.instagram ?? [])],
        },
    };
}

function AgePicker({ value, options, onChange, ariaLabel }) {
    const root = useRef(null);
    const [query, setQuery] = useState(String(value));
    const [open, setOpen] = useState(false);
    const visible = options.filter((age) => String(age).includes(query.trim()));

    useEffect(() => {
        setQuery(String(value));
    }, [value]);
    useEffect(() => {
        const close = (event) => {
            if (!root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    return <div ref={root} className="template-age-picker">
        <input
            aria-label={ariaLabel}
            inputMode="numeric"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
                setQuery(event.target.value.replace(/\D/g, ""));
                setOpen(true);
            }}
        />
        {open && <div className="template-age-options">
            {visible.length === 0 && <span>Немає такого віку</span>}
            {visible.map((age) => <button type="button" key={age} className={age === value ? "selected" : ""} onClick={() => {
                onChange(age);
                setQuery(String(age));
                setOpen(false);
            }}>{age === 65 ? "65+" : age}</button>)}
        </div>}
    </div>;
}

function OperatingSystemIcon({ operatingSystems = [] }) {
    if (operatingSystems.includes("Android")) {
        return <span className="template-os-icon android" title="Android" aria-label="Android"><Bot size={17} /></span>;
    }
    if (operatingSystems.includes("iOS")) {
        return <span className="template-os-icon ios" title="iOS" aria-label="iOS"><Smartphone size={17} /></span>;
    }
    return <span className="muted-value">—</span>;
}


export default function TemplatesTab({
    onError,
    showToast,
    embedded = false,
    createRequest = 0,
    onCreated,
    onClose,
}) {
    const [templates, setTemplates] = useState([]);
    const [countries, setCountries] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [editor, setEditor] = useState(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [countryToAdd, setCountryToAdd] = useState("");
    const [languageToAdd, setLanguageToAdd] = useState("");
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const [sortColumn, setSortColumn] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");

    const load = async () => {
        setLoading(true);
        try {
            const [loadedTemplates, loadedCountries, loadedLanguages] = await Promise.all([
                unwrap(window.adsBot.getTemplates()),
                unwrap(window.adsBot.getCountries()),
                unwrap(window.adsBot.getLanguages
                    ? window.adsBot.getLanguages()
                    : { ok: true, data: [] }),
            ]);
            setTemplates(loadedTemplates);
            setCountries(loadedCountries);
            setLanguages(loadedLanguages);
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

    const visibleTemplates = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        const filtered = needle
            ? templates.filter((template) => templateSearchText(template).includes(needle))
            : templates;
        return [...filtered].sort((left, right) => (
            compareTemplates(left, right, sortColumn, sortDirection)
        ));
    }, [templates, search, sortColumn, sortDirection]);

    const toggleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection((current) => current === "asc" ? "desc" : "asc");
            return;
        }
        setSortColumn(column);
        setSortDirection(column === "updatedAt" ? "desc" : "asc");
    };

    const sortMark = (column) => (
        sortColumn === column ? (sortDirection === "asc" ? " ▲" : " ▼") : ""
    );

    const openCreate = () => {
        setDraft(emptyDraft());
        setCountryToAdd("");
        setLanguageToAdd("");
        setEditor({ mode: "create" });
    };

    const openEdit = (template) => {
        setDraft(cloneTemplate(template));
        setCountryToAdd("");
        setLanguageToAdd("");
        setEditor({ mode: "edit", id: template.id });
    };

    const closeEditor = () => {
        setEditor(null);
        if (embedded) onClose?.();
    };

    useEffect(() => {
        if (embedded && createRequest > 0) openCreate();
    }, [createRequest, embedded]);

    const toggleCountry = (code) => {
        setDraft((current) => ({
            ...current,
            countryCodes: current.countryCodes.includes(code)
                ? current.countryCodes.filter((item) => item !== code)
                : [...current.countryCodes, code],
        }));
    };

    const toggleLanguage = (id) => {
        const languageId = Number(id);
        setDraft((current) => ({
            ...current,
            locales: current.locales.includes(languageId)
                ? current.locales.filter((item) => item !== languageId)
                : [...current.locales, languageId],
        }));
    };

    const addCountry = (code) => {
        if (!draft.countryCodes.includes(code)) toggleCountry(code);
        setCountryToAdd("");
    };

    const addLanguage = (code) => {
        const language = languages.find((item) => item.code === code);
        if (language && !draft.locales.includes(Number(language.id))) {
            toggleLanguage(language.id);
        }
        setLanguageToAdd("");
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
            if (editor.mode === "create") onCreated?.(saved);
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
        <motion.section className={`tab-content templates-content ${embedded ? "template-editor-embedded" : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
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

            <div className="templates-toolbar">
                <label>
                    <Search size={15} />
                    <input
                        aria-label="Пошук шаблонів"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Назва, ID, країна…"
                    />
                </label>
                {!loading && templates.length > 0 && (
                    <span>{visibleTemplates.length} з {templates.length}</span>
                )}
            </div>

            <div className="templates-table-card">
                <div className="templates-table-head templates-grid">
                    <button type="button" className="comment-sort" onClick={() => toggleSort("id")}>ID{sortMark("id")}</button>
                    <button type="button" className="comment-sort" onClick={() => toggleSort("name")}>Назва{sortMark("name")}</button>
                    <button type="button" className="comment-sort" onClick={() => toggleSort("countries")}>Країни{sortMark("countries")}</button>
                    <span>Мови</span>
                    <button type="button" className="comment-sort" onClick={() => toggleSort("audience")}>Аудиторія{sortMark("audience")}</button>
                    <span>ОС</span>
                    <button type="button" className="comment-sort" onClick={() => toggleSort("updatedAt")}>Оновлено{sortMark("updatedAt")}</button>
                    <span>Дії</span>
                </div>
                {loading && <div className="templates-empty"><LoaderCircle className="spin" size={23} /> Завантажуємо шаблони…</div>}
                {!loading && templates.length === 0 && (
                    <div className="templates-empty">
                        <LayoutTemplate size={31} />
                        <strong>Шаблонів ще немає</strong>
                        <span>Створіть перший шаблон рекламної кампанії.</span>
                    </div>
                )}
                {!loading && templates.length > 0 && visibleTemplates.length === 0 && (
                    <div className="templates-empty">
                        <Search size={31} />
                        <strong>Нічого не знайдено</strong>
                        <span>Спробуйте інший запит пошуку.</span>
                    </div>
                )}
                {!loading && visibleTemplates.map((template) => (
                    <div key={template.id} className="template-row templates-grid" role="button" tabIndex={0} onClick={() => openEdit(template)} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openEdit(template);
                    }}>
                        <span className="template-id"><i className="status-dot active" />{template.id}</span>
                        <strong>{template.name}</strong>
                        <span>{template.countryCodes?.join(", ") || "Країни не вибрані"}</span>
                        <span className={template.locales?.length ? "template-language-codes" : "muted-value"}>{template.locales?.map((id) => languages.find((language) => Number(language.id) === Number(id))?.code || id).join(", ") || "—"}</span>
                        <span className={template.countryCodes?.length ? "" : "muted-value"}>
                            {audienceText(template)}
                        </span>
                        <OperatingSystemIcon operatingSystems={template.operatingSystems} />
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
                <div className="overlay template-editor-overlay" onMouseDown={() => !saving && closeEditor()}>
                    <motion.form className="modal template-editor expanded" initial={{ opacity: 0, y: 20, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
                        <button className="modal-close" type="button" disabled={saving} onClick={closeEditor}><X size={17} /></button>
                        <div className="modal-icon template-icon"><FilePenLine /></div>
                        <span className="eyebrow">{editor.mode === "edit" ? `Template ID ${editor.id}` : "New template"}</span>
                        <h2>{editor.mode === "edit" ? "Редагувати шаблон" : "Новий шаблон"}</h2>

                        <div className="template-editor-scroll">
                            <div className="template-editor-fields two-columns">
                                <label className="field"><span>Назва</span><input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Наприклад, AT Slot" /></label>
                            </div>

                            <section className="template-form-section">
                                <header><strong>Аудиторія</strong><small>Advantage audience вимкнено</small></header>
                                <label className="field country-picker"><span>Додати країну</span><GeoSelect countries={countries} value={countryToAdd} onChange={addCountry} layout="list" placeholder="Оберіть країну" ariaLabel="Додати країну" /></label>
                                <div className="selected-template-codes">
                                    <strong>Вибрані країни</strong>
                                    {draft.countryCodes.map((code) => <button type="button" key={code} onClick={() => toggleCountry(code)}>{code} <X size={11} /></button>)}
                                </div>
                                <label className="field country-picker"><span>Додати мову</span><GeoSelect countries={languages} value={languageToAdd} onChange={addLanguage} layout="list" placeholder="Оберіть мову" ariaLabel="Додати мову" /></label>
                                <div className="selected-template-codes">
                                    <strong>Вибрані мови</strong>
                                    {draft.locales.map((id) => {
                                        const language = languages.find((item) => Number(item.id) === Number(id));
                                        return <button type="button" key={id} onClick={() => toggleLanguage(id)}>{language?.code || id} <X size={11} /></button>;
                                    })}
                                </div>
                                <small className="field-hint">Можна вибрати одну або кілька мов. Порожній список означає, що фільтр мов не застосовується.</small>
                                <div className="template-editor-fields three-columns">
                                    <label className="field"><span>Стать</span><select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value }))}><option value="any">Будь-яка</option><option value="male">Чоловіча</option><option value="female">Жіноча</option></select></label>
                                    <label className="field"><span>Вік від</span><AgePicker value={draft.ageMin} options={ageOptions} ariaLabel="Вік від" onChange={(ageMin) => setDraft((current) => ({ ...current, ageMin, ageMax: Math.max(ageMin, current.ageMax) }))} /></label>
                                    <label className="field"><span>Вік до</span><AgePicker value={draft.ageMax} options={ageOptions.filter((age) => age >= draft.ageMin)} ariaLabel="Вік до" onChange={(ageMax) => setDraft((current) => ({ ...current, ageMax }))} /></label>
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
                                <label className="checkbox-line"><input type="checkbox" checked={draft.shareAdSetBudget} onChange={(event) => setDraft((current) => ({ ...current, shareAdSetBudget: event.target.checked }))} /><span><strong>Дозволити Meta розподіляти бюджет між ad sets</strong><small>Бюджети все одно задаються на рівні ad set.</small></span></label>
                                <label className="checkbox-line"><input type="checkbox" checked={draft.disableMultiAdvertiserAds !== false} onChange={(event) => setDraft((current) => ({ ...current, disableMultiAdvertiserAds: event.target.checked }))} /><span><strong>Вимкнути Multi-advertiser ads</strong><small>Увімкнено за замовчуванням для нових і наявних шаблонів.</small></span></label>
                                <label className="checkbox-line"><input type="checkbox" checked={draft.disableCreativeEnhancements !== false} onChange={(event) => setDraft((current) => ({ ...current, disableCreativeEnhancements: event.target.checked }))} /><span><strong>Вимкнути Advantage+ creative enhancements</strong><small>Вимикає відомі API-покращення медіа, тексту, CTA та товарних елементів.</small></span></label>
                            </section>
                        </div>

                        <div className="form-actions">
                            <button className="secondary-button" type="button" disabled={saving} onClick={closeEditor}>Скасувати</button>
                            <button className="primary-button" type="submit" disabled={!draft.name.trim() || saving}>{saving && <LoaderCircle className="spin" size={16} />}{editor.mode === "edit" ? "Зберегти зміни" : "Створити шаблон"}</button>
                        </div>
                    </motion.form>
                </div>
            )}
        </motion.section>
    );
}
