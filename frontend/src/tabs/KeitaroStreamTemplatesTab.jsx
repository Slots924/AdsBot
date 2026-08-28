import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    Copy,
    FilePenLine,
    LoaderCircle,
    Plus,
    Search,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import {
    filterLabel,
    keitaroFilterTypes,
    keitaroStreamSchemas,
    keitaroStreamTypes,
    parsePayload,
    payloadKind,
    payloadText,
} from "../lib/keitaroStreams.js";

const editorTabs = [
    ["main", "Основні"],
    ["schema", "Схема"],
    ["filters", "Фільтри"],
    ["monitoring", "Моніторинг"],
    ["notes", "Нотатки"],
];

function emptyDraft() {
    return {
        name: "",
        sourceStreamId: null,
        stream: {
            type: "regular",
            name: "",
            comments: "",
            state: "active",
            schema: "landings",
            collect_clicks: false,
            filter_or: false,
            weight: 100,
            offer_selection: "before_click",
            action_type: "http",
            action_payload: "",
            filters: [],
            landings: [],
            offers: [],
            triggers: [],
        },
    };
}

function cloneDraft(template) {
    const blank = emptyDraft();
    return structuredClone({
        ...blank,
        ...template,
        stream: { ...blank.stream, ...(template.stream ?? {}) },
    });
}

function formatUpdatedAt(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("uk-UA", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(value));
}

export default function KeitaroStreamTemplatesTab({ onError, showToast }) {
    const [templates, setTemplates] = useState([]);
    const [countries, setCountries] = useState([]);
    const [countriesLoading, setCountriesLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [editorId, setEditorId] = useState(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [saving, setSaving] = useState(false);

    const filtered = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        return needle
            ? templates.filter((item) => `${item.id} ${item.name} ${item.stream?.name}`
                .toLocaleLowerCase().includes(needle))
            : templates;
    }, [templates, search]);

    const load = async () => {
        setLoading(true);
        try {
            setTemplates(await unwrap(window.adsBot.getKeitaroStreamTemplates()) ?? []);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити шаблони потоків" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const ensureCountries = useCallback(async () => {
        if (countries.length || countriesLoading) return;
        setCountriesLoading(true);
        try {
            setCountries(await unwrap(window.adsBot.getKeitaroCountries()));
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити країни Keitaro" });
        } finally {
            setCountriesLoading(false);
        }
    }, [countries.length, countriesLoading, onError]);

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                ...draft,
                name: draft.name || draft.stream.name,
                stream: { ...draft.stream, name: draft.stream.name || draft.name },
            };
            if (editorId === "new") {
                await unwrap(window.adsBot.createKeitaroStreamTemplate(payload));
                showToast?.("Шаблон потоку створено", "success");
            } else {
                await unwrap(window.adsBot.updateKeitaroStreamTemplate(editorId, payload));
                showToast?.("Шаблон потоку збережено", "success");
            }
            setEditorId(null);
            await load();
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося зберегти шаблон потоку" });
        } finally {
            setSaving(false);
        }
    };

    const run = async (id, operation, successMessage) => {
        setBusyId(id);
        try {
            await unwrap(operation());
            showToast?.(successMessage, "success");
            await load();
        } catch (error) {
            onError({ ...errorDetails(error), title: "Операція з шаблоном не виконана" });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <motion.section className="keitaro-tab keitaro-streams-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="keitaro-heading">
                <div>
                    <span className="eyebrow">Keitaro streams</span>
                    <h1>Шаблони потоків</h1>
                    <p>Повні шаблони з основними параметрами, схемою, фільтрами та моніторингом.</p>
                </div>
                <div className="stream-heading-actions">
                    <button type="button" className="primary-button" onClick={() => {
                        setDraft(emptyDraft());
                        setEditorId("new");
                    }}>
                        <Plus size={16} /> Новий шаблон
                    </button>
                </div>
            </div>

            <div className="keitaro-toolbar">
                <label className="keitaro-search">
                    <Search size={16} />
                    <input aria-label="Пошук шаблонів потоків" value={search}
                        onChange={(event) => setSearch(event.target.value)} placeholder="Пошук шаблону…" />
                </label>
            </div>

            <div className="campaign-table-card keitaro-table stream-template-list">
                {loading && <div className="campaign-loading"><LoaderCircle className="spin" size={21} /> Завантажуємо шаблони…</div>}
                {!loading && filtered.length === 0 && <div className="campaign-empty">Шаблонів потоків немає.</div>}
                {!loading && filtered.map((template) => (
                    <div key={template.id} className="stream-template-row">
                        <div className="stream-template-icon">S</div>
                        <div className="stream-template-info">
                            <strong>{template.name}</strong>
                            <small>
                                Потік «{template.stream?.name || "Без назви"}» · {template.stream?.filters?.length || 0} фільтрів · {template.stream?.landings?.length || 0} лендінгів · {template.stream?.offers?.length || 0} оферів
                            </small>
                            <small>{template.sourceStreamId ? `Джерело: потік ${template.sourceStreamId} · ` : ""}Оновлено {formatUpdatedAt(template.updatedAt)}</small>
                        </div>
                        <div className="stream-template-actions">
                            <button type="button" className="secondary-button" onClick={() => {
                                setDraft(cloneDraft(template));
                                setEditorId(template.id);
                            }}><FilePenLine size={15} /> Редагувати</button>
                            <button type="button" className="icon-button" title="Створити копію" disabled={busyId === template.id}
                                onClick={() => run(template.id, () => window.adsBot.duplicateKeitaroStreamTemplate(template.id), "Шаблон скопійовано")}>
                                <Copy size={16} />
                            </button>
                            <button type="button" className="icon-button danger" title="Видалити" disabled={busyId === template.id}
                                onClick={() => window.confirm(`Видалити шаблон «${template.name}»?`) && run(template.id, () => window.adsBot.deleteKeitaroStreamTemplate(template.id), "Шаблон видалено")}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {editorId && <StreamEditor draft={draft} setDraft={setDraft} countries={countries}
                countriesLoading={countriesLoading} ensureCountries={ensureCountries}
                saving={saving} onClose={() => setEditorId(null)} onSave={save} />}
        </motion.section>
    );
}

function Choice({ checked, onChange, children }) {
    return <label className="stream-choice"><input type="radio" checked={checked} onChange={onChange} /> {children}</label>;
}

function TogglePair({ value, onChange, yes = "Так", no = "Ні" }) {
    return (
        <span className="stream-toggle-pair">
            <button type="button" className={value ? "active" : ""} onClick={() => onChange(true)}>{yes}</button>
            <button type="button" className={!value ? "active" : ""} onClick={() => onChange(false)}>{no}</button>
        </span>
    );
}

function StreamEditor({
    draft,
    setDraft,
    countries,
    countriesLoading,
    ensureCountries,
    saving,
    onClose,
    onSave,
}) {
    const [tab, setTab] = useState("main");
    const [pickerKind, setPickerKind] = useState("");
    const stream = draft.stream;
    const patchStream = (patch) => setDraft((current) => ({
        ...current,
        stream: { ...current.stream, ...patch },
    }));
    const updateFilter = (index, patch) => patchStream({
        filters: stream.filters.map((item, current) => current === index ? { ...item, ...patch } : item),
    });

    const addAsset = (kind, source) => {
        const key = kind === "landings" ? "landing_id" : "offer_id";
        if (!source || stream[kind].some((item) => String(item[key]) === String(source.id))) return;
        patchStream({
            [kind]: [...stream[kind], {
                [key]: Number(source.id),
                name: source.name,
                groupId: source.groupId || "",
                state: "active",
                share: 100,
            }],
        });
    };

    return (
        <div className="stream-editor-overlay" role="dialog" aria-modal="true" aria-label="Редагування шаблону потоку">
            <div className="stream-editor keitaro-like-editor">
                <header className="stream-editor-head">
                    <div><h2>Редагування шаблону потоку</h2><small>Позиція задається Keitaro під час додавання та не зберігається в шаблоні.</small></div>
                    <button type="button" className="icon-button" aria-label="Закрити" onClick={onClose}><X size={19} /></button>
                </header>

                <nav className="stream-editor-tabs">
                    {editorTabs.map(([id, label]) => (
                        <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                            {label}{id === "schema" ? ` (${stream.landings.length + stream.offers.length})` : id === "filters" ? ` (${stream.filters.length})` : ""}
                        </button>
                    ))}
                </nav>

                <div className="stream-editor-body">
                    {tab === "main" && <MainPanel draft={draft} setDraft={setDraft} stream={stream} patchStream={patchStream} />}
                    {tab === "schema" && <SchemaPanel stream={stream} patchStream={patchStream} onOpenPicker={setPickerKind} />}
                    {tab === "filters" && <FiltersPanel stream={stream} patchStream={patchStream} updateFilter={updateFilter} countries={countries} countriesLoading={countriesLoading} ensureCountries={ensureCountries} />}
                    {tab === "monitoring" && <MonitoringPanel stream={stream} patchStream={patchStream} />}
                    {tab === "notes" && <label className="stream-field"><span>Нотатки</span><textarea className="stream-notes" value={stream.comments} onChange={(event) => patchStream({ comments: event.target.value })} placeholder="Додайте внутрішню нотатку до шаблону" /></label>}
                </div>

                <footer className="stream-editor-foot">
                    <button type="button" className="secondary-button" onClick={onClose}>Скасувати</button>
                    <button type="button" className="primary-button" disabled={saving || !(draft.name || stream.name).trim()} onClick={onSave}>
                        {saving && <LoaderCircle className="spin" size={16} />} Застосувати
                    </button>
                </footer>
            </div>
            {pickerKind && <AssetPickerModal kind={pickerKind} selectedAssets={stream[pickerKind]}
                onClose={() => setPickerKind("")} onAdd={(asset) => {
                    addAsset(pickerKind, asset);
                    setPickerKind("");
                }} />}
        </div>
    );
}

function MainPanel({ draft, setDraft, stream, patchStream }) {
    return (
        <div className="stream-panel">
            <label className="stream-field"><span>Назва шаблону</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Наприклад, White JP" /></label>
            <label className="stream-field"><span>Назва потоку</span><input value={stream.name} onChange={(event) => patchStream({ name: event.target.value })} placeholder="Назва, яка з'явиться у Keitaro" /></label>
            <div className="stream-setting"><strong>Тип потоку</strong><div className="stream-choice-row">
                {keitaroStreamTypes.map((item) => <Choice key={item.id} checked={stream.type === item.id} onChange={() => patchStream({ type: item.id })}>{item.label}</Choice>)}
            </div></div>
            <div className="stream-setting"><strong>Рахувати кліки</strong><div className="stream-choice-row"><Choice checked={stream.collect_clicks} onChange={() => patchStream({ collect_clicks: true })}>Так</Choice><Choice checked={!stream.collect_clicks} onChange={() => patchStream({ collect_clicks: false })}>Ні</Choice></div></div>
            <div className="stream-setting"><strong>Стан</strong><div className="stream-choice-row"><Choice checked={stream.state === "active"} onChange={() => patchStream({ state: "active" })}>Увімкнено</Choice><Choice checked={stream.state === "disabled"} onChange={() => patchStream({ state: "disabled" })}>Вимкнено</Choice></div></div>
        </div>
    );
}

function SchemaPanel({ stream, patchStream, onOpenPicker }) {
    const patchAsset = (kind, index, patch) => patchStream({
        [kind]: stream[kind].map((item, current) => current === index ? { ...item, ...patch } : item),
    });
    return (
        <div className="stream-panel">
            <div className="stream-choice-row schema-choices">
                {keitaroStreamSchemas.map((item) => <Choice key={item.id} checked={stream.schema === item.id} onChange={() => patchStream({ schema: item.id })}>{item.label}</Choice>)}
            </div>
            {stream.schema === "landings" ? <>
                <AssetSection title="Лендінги" kind="landings" assets={stream.landings} idKey="landing_id" onOpenPicker={onOpenPicker} onPatch={patchAsset} onRemove={(index) => patchStream({ landings: stream.landings.filter((_, current) => current !== index) })} />
                <AssetSection title="Офери" kind="offers" assets={stream.offers} idKey="offer_id" onOpenPicker={onOpenPicker} onPatch={patchAsset} onRemove={(index) => patchStream({ offers: stream.offers.filter((_, current) => current !== index) })} />
                <div className="stream-setting"><strong>Вибір оферу</strong><div className="stream-choice-row"><Choice checked={stream.offer_selection === "before_click"} onChange={() => patchStream({ offer_selection: "before_click" })}>Перед кліком</Choice><Choice checked={stream.offer_selection === "after_click"} onChange={() => patchStream({ offer_selection: "after_click" })}>Після кліку</Choice></div></div>
            </> : <div className="stream-action-fields">
                <label className="stream-field"><span>{stream.schema === "redirects" ? "URL-адреса" : "Тип дії"}</span>{stream.schema === "redirects" ? <input value={stream.action_payload} onChange={(event) => patchStream({ action_payload: event.target.value, action_type: "http" })} placeholder="https://example.com" /> : <select value={stream.action_type} onChange={(event) => patchStream({ action_type: event.target.value })}><option value="http">HTTP redirect</option><option value="remote">Remote</option><option value="do_nothing">Нічого не робити</option><option value="show_text">Показати текст</option></select>}</label>
                {stream.schema === "action" && stream.action_type !== "do_nothing" && <label className="stream-field"><span>Значення дії</span><textarea value={stream.action_payload} onChange={(event) => patchStream({ action_payload: event.target.value })} /></label>}
            </div>}
        </div>
    );
}

function AssetSection({ title, kind, assets, idKey, onOpenPicker, onPatch, onRemove }) {
    return <section className="stream-assets-section"><div className="stream-section-title"><strong>{title}</strong><button type="button" className="secondary-button" onClick={() => onOpenPicker(kind)}><Plus size={15} /> Додати {title.toLocaleLowerCase()}</button></div>{assets.length === 0 && <div className="stream-empty-line">Нічого не додано</div>}{assets.map((item, index) => <div className="stream-asset-row" key={`${item[idKey]}-${index}`}><div><strong>{item.name || `${title} ${item[idKey]}`}</strong><small>ID {item[idKey]}{item.groupId ? ` · група ${item.groupId}` : ""}</small></div><label><input type="number" min="0" max="100" value={item.share} onChange={(event) => onPatch(kind, index, { share: Number(event.target.value) })} /> %</label><TogglePair value={item.state !== "disabled"} yes="Увімк." no="Вимк." onChange={(value) => onPatch(kind, index, { state: value ? "active" : "disabled" })} /><button type="button" className="icon-button danger" onClick={() => onRemove(index)}><Trash2 size={15} /></button></div>)}</section>;
}

function AssetPickerModal({ kind, selectedAssets, onClose, onAdd }) {
    const [groups, setGroups] = useState([]);
    const [groupId, setGroupId] = useState("");
    const [assets, setAssets] = useState([]);
    const [groupsLoading, setGroupsLoading] = useState(true);
    const [assetsLoading, setAssetsLoading] = useState(false);
    const [query, setQuery] = useState("");
    const title = kind === "offers" ? "офер" : "лендінг";
    const idKey = kind === "offers" ? "offer_id" : "landing_id";

    useEffect(() => {
        unwrap(window.adsBot.getKeitaroAssetGroups(kind))
            .then((items) => setGroups(items ?? []))
            .catch(() => setGroups([]))
            .finally(() => setGroupsLoading(false));
    }, [kind]);

    useEffect(() => {
        if (!groupId) {
            setAssets([]);
            return;
        }
        setAssetsLoading(true);
        const request = kind === "offers"
            ? window.adsBot.getKeitaroOffers({ groupId })
            : window.adsBot.getKeitaroLandingPages({ groupId });
        unwrap(request)
            .then((items) => setAssets(items ?? []))
            .catch(() => setAssets([]))
            .finally(() => setAssetsLoading(false));
    }, [kind, groupId]);

    const visible = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle
            ? assets.filter((item) => `${item.id} ${item.name}`.toLocaleLowerCase().includes(needle))
            : assets;
    }, [assets, query]);
    const selectedIds = new Set(selectedAssets.map((item) => String(item[idKey])));

    return <div className="asset-picker-overlay" role="dialog" aria-modal="true" aria-label={`Вибір ${title}ів`}>
        <div className="asset-picker-modal">
            <header><div><h3>Додати {title}</h3><p>Спочатку оберіть групу, потім потрібний елемент.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></header>
            <div className="asset-picker-body">
                <label className="stream-field"><span>Група {title}ів</span><select value={groupId} disabled={groupsLoading} onChange={(event) => setGroupId(event.target.value)}><option value="">Оберіть групу</option><option value="all">Усі групи</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                {groupId && <label className="keitaro-search asset-picker-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Пошук ${title}ів…`} /></label>}
                {groupsLoading && <div className="campaign-loading"><LoaderCircle className="spin" size={19} /> Завантажуємо групи…</div>}
                {!groupsLoading && !groupId && <div className="stream-empty-line">Оберіть групу або «Усі групи».</div>}
                {assetsLoading && <div className="campaign-loading"><LoaderCircle className="spin" size={19} /> Завантажуємо {title}и…</div>}
                {!assetsLoading && groupId && <div className="asset-picker-list">{visible.length === 0 && <div className="stream-empty-line">У цій групі нічого не знайдено.</div>}{visible.map((asset) => <button type="button" key={asset.id} className="asset-picker-item" disabled={selectedIds.has(String(asset.id))} onClick={() => onAdd(asset)}><span><strong>{asset.name}</strong><small>ID {asset.id}</small></span>{selectedIds.has(String(asset.id)) ? "Додано" : <Plus size={17} />}</button>)}</div>}
            </div>
        </div>
    </div>;
}

function FiltersPanel({ stream, patchStream, updateFilter, countries, countriesLoading, ensureCountries }) {
    useEffect(() => { ensureCountries(); }, [ensureCountries]);
    const remove = (index) => patchStream({ filters: stream.filters.filter((_, current) => current !== index) });
    return <div className="stream-panel"><div className="stream-filter-toolbar"><select value="" onChange={(event) => { const name = event.target.value; if (name) patchStream({ filters: [...stream.filters, { name, mode: "accept", payload: payloadKind(name) === "none" ? null : [] }] }); }}><option value="">Додати фільтр</option>{keitaroFilterTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="stream-relation"><strong>Відношення</strong><Choice checked={!stream.filter_or} onChange={() => patchStream({ filter_or: false })}>І</Choice><Choice checked={stream.filter_or} onChange={() => patchStream({ filter_or: true })}>АБО</Choice></div>{stream.filters.map((filter, index) => <section key={`${filter.name}-${index}`} className="stream-filter-card"><div className="stream-filter-head"><strong>{filterLabel(filter.name)}</strong><TogglePair value={filter.mode !== "reject"} onChange={(value) => updateFilter(index, { mode: value ? "accept" : "reject" })} /><button type="button" className="danger-link" onClick={() => remove(index)}><Trash2 size={14} /> Видалити</button></div><FilterPayload filter={filter} countries={countries} countriesLoading={countriesLoading} onChange={(payload) => updateFilter(index, { payload })} /></section>)}</div>;
}

function FilterPayload({ filter, countries, countriesLoading, onChange }) {
    const kind = payloadKind(filter.name);
    if (kind === "none") return <div className="stream-empty-line">Цей фільтр не потребує додаткових значень.</div>;
    if (kind === "country") {
        const selected = Array.isArray(filter.payload) ? filter.payload : [];
        return <div className="country-filter-editor"><select value="" disabled={countriesLoading} onChange={(event) => { const code = event.target.value; if (code && !selected.includes(code)) onChange([...selected, code]); }}><option value="">{countriesLoading ? "Завантажуємо країни…" : "Оберіть країну зі списку Keitaro"}</option>{countries.filter((item) => !selected.includes(item.code)).map((item) => <option key={item.code} value={item.code}>{item.name || item.code} ({item.code})</option>)}</select>{!countriesLoading && countries.length === 0 && <small>Список країн Keitaro недоступний. Перевірте підключення до трекера.</small>}<div className="country-filter-chips">{selected.map((code) => <button type="button" key={code} onClick={() => onChange(selected.filter((item) => item !== code))}>{countries.find((item) => item.code === code)?.name || code} <X size={13} /></button>)}</div></div>;
    }
    return <textarea className="stream-filter-values" value={payloadText(filter.payload)} onChange={(event) => onChange(parsePayload(filter.name, event.target.value))} placeholder="Кожне значення з нового рядка" />;
}

function MonitoringPanel({ stream, patchStream }) {
    const [text, setText] = useState(() => JSON.stringify(stream.triggers ?? [], null, 2));
    const [error, setError] = useState("");
    const save = () => {
        try {
            const parsed = JSON.parse(text || "[]");
            if (!Array.isArray(parsed)) throw new Error("Потрібен масив");
            patchStream({ triggers: parsed });
            setError("");
        } catch {
            setError("Моніторинг має бути JSON-масивом правил Keitaro.");
        }
    };
    return <div className="stream-panel"><label className="stream-field"><span>Правила моніторингу Keitaro</span><textarea className="stream-monitoring-json" value={text} onChange={(event) => setText(event.target.value)} onBlur={save} spellCheck="false" /></label>{error && <div className="stream-warning">{error}</div>}<p className="stream-help">Правила зберігаються без втрати полів у масиві <code>triggers</code>. Після редагування клацніть поза полем — JSON буде перевірено.</p></div>;
}
