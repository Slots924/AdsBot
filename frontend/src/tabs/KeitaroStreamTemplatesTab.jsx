import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Copy, LoaderCircle, Minus, Plus, Search, Trash2, X } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";

function emptyDraft() {
    return { name: "", sourceStreamId: null, stream: { type: "regular", name: "", comments: "", state: "active", schema: "landings", collect_clicks: true, filter_or: false, weight: 100, offer_selection: "before_click", action_type: "http", action_payload: "", filters: [], landings: [], offers: [], triggers: [] } };
}

function cloneDraft(template) {
    const blank = emptyDraft();
    return structuredClone({ ...blank, ...template, stream: { ...blank.stream, ...(template.stream ?? {}) } });
}

let activeSavedDraft = null;

export default function KeitaroStreamTemplatesTab({ onError, showToast }) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [savedDraft, setSavedDraft] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = async (preferredId) => {
        setLoading(true);
        try {
            const items = await unwrap(window.adsBot.getKeitaroStreamTemplates()) ?? [];
            setTemplates(items);
            const targetId = preferredId ?? selectedId;
            const selected = items.find((item) => item.id === targetId) ?? items[0] ?? null;
            setSelectedId(selected?.id ?? null);
            const nextDraft = selected ? cloneDraft(selected) : null;
            setDraft(nextDraft);
            setSavedDraft(nextDraft ? structuredClone(nextDraft) : null);
            activeSavedDraft = nextDraft ? structuredClone(nextDraft) : null;
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити шаблони потоків" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        return needle ? templates.filter((item) => `${item.id} ${item.name} ${item.stream?.name}`.toLocaleLowerCase().includes(needle)) : templates;
    }, [templates, search]);

    const selectTemplate = (template) => {
        const nextDraft = cloneDraft(template);
        setSelectedId(template.id);
        setDraft(nextDraft);
        setSavedDraft(structuredClone(nextDraft));
        activeSavedDraft = structuredClone(nextDraft);
    };
    const create = () => {
        const nextDraft = emptyDraft();
        setSelectedId("new");
        setDraft(nextDraft);
        setSavedDraft(structuredClone(nextDraft));
        activeSavedDraft = structuredClone(nextDraft);
    };

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const payload = { ...draft, name: draft.name || draft.stream.name, stream: { ...draft.stream, name: draft.stream.name || draft.name } };
            const saved = selectedId === "new" ? await unwrap(window.adsBot.createKeitaroStreamTemplate(payload)) : await unwrap(window.adsBot.updateKeitaroStreamTemplate(selectedId, payload));
            showToast?.(selectedId === "new" ? "Шаблон потоку створено" : "Шаблон потоку збережено", "success");
            await load(saved.id);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося зберегти шаблон потоку" });
        } finally { setSaving(false); }
    };

    const run = async (id, operation, successMessage, preferredId) => {
        setBusyId(id);
        try {
            const result = await unwrap(operation());
            showToast?.(successMessage, "success");
            await load(preferredId ?? result?.id);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Операція з шаблоном не виконана" });
        } finally { setBusyId(null); }
    };

    return <motion.section className="keitaro-tab keitaro-streams-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="keitaro-heading"><div><span className="eyebrow">Keitaro streams</span><h1>Шаблони потоків</h1><p>Оберіть шаблон ліворуч, щоб налаштувати його праворуч.</p></div><button type="button" className="primary-button" onClick={create}><Plus size={16} /> Новий шаблон</button></div>
        <div className="stream-templates-workspace">
            <aside className="stream-template-sidebar" aria-label="Список шаблонів потоків">
                <label className="keitaro-search stream-template-search"><Search size={16} /><input aria-label="Пошук шаблонів потоків" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук шаблону…" /></label>
                <div className="stream-template-list">
                    {loading && <div className="campaign-loading"><LoaderCircle className="spin" size={21} /> Завантажуємо шаблони…</div>}
                    {!loading && filtered.length === 0 && <div className="campaign-empty">Шаблонів потоків немає.</div>}
                    {!loading && filtered.map((template) => <div key={template.id} className={`stream-template-row ${selectedId === template.id ? "selected" : ""}`}>
                        <button type="button" className="stream-template-select" onClick={() => selectTemplate(template)}><span className="stream-template-icon">S</span><strong>{template.name}</strong></button>
                        <span className="stream-template-actions">
                            <button type="button" className="icon-button" title="Створити копію" aria-label={`Створити копію ${template.name}`} disabled={busyId === template.id} onClick={() => run(template.id, () => window.adsBot.duplicateKeitaroStreamTemplate(template.id), "Шаблон скопійовано")}><Copy size={16} /></button>
                            <button type="button" className="icon-button danger" title="Видалити" aria-label={`Видалити ${template.name}`} disabled={busyId === template.id} onClick={() => window.confirm(`Видалити шаблон «${template.name}»?`) && run(template.id, () => window.adsBot.deleteKeitaroStreamTemplate(template.id), "Шаблон видалено", selectedId === template.id ? null : selectedId)}><Trash2 size={16} /></button>
                        </span>
                    </div>)}
                </div>
            </aside>
            <main className="stream-template-detail">{draft ? <TemplateDetails draft={draft} setDraft={setDraft} saving={saving} onSave={save} /> : <div className="stream-template-placeholder">Оберіть шаблон або створіть новий.</div>}</main>
        </div>
    </motion.section>;
}

function TemplateDetails({ draft, savedDraft = activeSavedDraft, setDraft, saving: savingProp, onSave }) {
    const [pickerKind, setPickerKind] = useState("");
    const stream = draft.stream;
    const hasChanges = JSON.stringify(draft) !== JSON.stringify(savedDraft);
    const saving = savingProp || !hasChanges;
    const patchStream = (patch) => setDraft((current) => ({ ...current, stream: { ...current.stream, ...patch } }));
    const patchAsset = (kind, index, patch) => patchStream({ [kind]: stream[kind].map((item, current) => current === index ? { ...item, ...patch } : item) });
    const toggleAsset = (kind, source) => {
        const idKey = kind === "landings" ? "landing_id" : "offer_id";
        const exists = stream[kind].some((item) => String(item[idKey]) === String(source.id));
        patchStream({ [kind]: exists ? stream[kind].filter((item) => String(item[idKey]) !== String(source.id)) : [...stream[kind], { [idKey]: Number(source.id), name: source.name, groupId: source.groupId || "", state: "active", share: 100 }] });
    };
    return <><header className="stream-detail-head"><div><h2>{draft.id ? "Налаштування шаблону" : "Новий шаблон"}</h2><p>Тип «звичайний», рахування кліків, увімкнений стан, схема «лендінги та офери», вибір оферу перед кліком і відсутність фільтрів задаються автоматично.</p></div><button type="button" className="primary-button" disabled={saving || !hasChanges || !(draft.name || stream.name).trim()} onClick={onSave}>{savingProp && <LoaderCircle className="spin" size={16} />} Зберегти</button></header><div className="stream-detail-body"><section className="stream-panel stream-main-fields"><label className="stream-field"><span>Назва шаблону</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Наприклад, White JP" /></label><label className="stream-field"><span>Назва потоку</span><input value={stream.name} onChange={(event) => patchStream({ name: event.target.value })} placeholder="Назва, яка з'явиться у Keitaro" /></label></section><AssetSection title="Лендінги" kind="landings" assets={stream.landings} idKey="landing_id" onOpenPicker={setPickerKind} onPatch={patchAsset} onRemove={(index) => patchStream({ landings: stream.landings.filter((_, current) => current !== index) })} /><AssetSection title="Офери" kind="offers" assets={stream.offers} idKey="offer_id" onOpenPicker={setPickerKind} onPatch={patchAsset} onRemove={(index) => patchStream({ offers: stream.offers.filter((_, current) => current !== index) })} /></div>{pickerKind && <AssetPickerModal kind={pickerKind} selectedAssets={stream[pickerKind]} onClose={() => setPickerKind("")} onToggle={(asset) => toggleAsset(pickerKind, asset)} />}</>;
}

function AssetSection({ title, kind, assets, idKey, onOpenPicker, onPatch, onRemove }) {
    return <section className="stream-assets-section"><div className="stream-section-title"><strong>{title}</strong><button type="button" className="secondary-button" onClick={() => onOpenPicker(kind)}><Plus size={15} /> Додати {title.toLocaleLowerCase()}</button></div>{assets.length === 0 && <div className="stream-empty-line">Нічого не додано</div>}{assets.map((item, index) => {
        const enabled = item.state !== "disabled";
        return <div className="stream-asset-row" key={`${item[idKey]}-${index}`}><div><strong>{item.name || `${title} ${item[idKey]}`}</strong><small>ID {item[idKey]}{item.groupId ? ` · група ${item.groupId}` : ""}</small></div><label><input type="number" min="0" max="100" disabled={!enabled} value={item.share} onChange={(event) => onPatch(kind, index, { share: Math.max(0, Math.min(100, Number(event.target.value))) })} /> %</label><span className="stream-toggle-pair"><button type="button" className={enabled ? "active" : ""} onClick={() => onPatch(kind, index, { state: "active" })}>Увімк.</button><button type="button" className={!enabled ? "active off" : ""} onClick={() => onPatch(kind, index, { state: "disabled" })}>Вимк.</button></span><button type="button" className="icon-button danger" aria-label={`Видалити ${item.name || item[idKey]}`} onClick={() => onRemove(index)}><Trash2 size={15} /></button></div>;
    })}</section>;
}

function AssetPickerModal({ kind, selectedAssets, onClose, onToggle }) {
    const storageKey = `adsbot.keitaro-asset-picker.${kind}`;
    const storage = typeof localStorage !== "undefined"
        && typeof localStorage.getItem === "function"
        && typeof localStorage.setItem === "function"
        ? localStorage
        : null;
    let savedPicker = {};
    try {
        savedPicker = JSON.parse(storage?.getItem(storageKey) || "{}");
    } catch {
        // Пошкоджені локальні налаштування не повинні блокувати вибір елементів.
    }
    const [groups, setGroups] = useState([]); const [groupId, setGroupId] = useState(savedPicker.groupId || ""); const [assets, setAssets] = useState([]); const [groupsLoading, setGroupsLoading] = useState(true); const [assetsLoading, setAssetsLoading] = useState(false); const [query, setQuery] = useState(savedPicker.query || "");
    const title = kind === "offers" ? "офер" : "лендінг"; const idKey = kind === "offers" ? "offer_id" : "landing_id";
    useEffect(() => { unwrap(window.adsBot.getKeitaroAssetGroups(kind)).then((items) => setGroups([...(items ?? [])].sort((left, right) => left.name.localeCompare(right.name, "uk-UA", { numeric: true, sensitivity: "base" })))).catch(() => setGroups([])).finally(() => setGroupsLoading(false)); }, [kind]);
    useEffect(() => { if (!groupId) { setAssets([]); return; } setAssetsLoading(true); const request = kind === "offers" ? window.adsBot.getKeitaroOffers({ groupId }) : window.adsBot.getKeitaroLandingPages({ groupId }); unwrap(request).then((items) => setAssets(items ?? [])).catch(() => setAssets([])).finally(() => setAssetsLoading(false)); }, [kind, groupId]);
    useEffect(() => { storage?.setItem(storageKey, JSON.stringify({ groupId, query })); }, [storage, storageKey, groupId, query]);
    const visible = useMemo(() => { const needle = query.trim().toLocaleLowerCase(); return needle ? assets.filter((item) => `${item.id} ${item.name}`.toLocaleLowerCase().includes(needle)) : assets; }, [assets, query]);
    const selectedIds = new Set(selectedAssets.map((item) => String(item[idKey])));
    return <div className="asset-picker-overlay" role="dialog" aria-modal="true" aria-label={`Вибір ${title}ів`}><div className="asset-picker-modal"><header><div><h3>Додати {title}и</h3><p>Натискайте «+», щоб додати кілька елементів. Повторне натискання прибирає елемент.</p></div><button type="button" className="icon-button" aria-label="Закрити" onClick={onClose}><X size={18} /></button></header><div className="asset-picker-body"><label className="stream-field"><span>Група {title}ів</span><select value={groupId} disabled={groupsLoading} onChange={(event) => setGroupId(event.target.value)}><option value="">Оберіть групу</option><option value="all">Усі групи</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{groupId && <label className="keitaro-search asset-picker-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Пошук ${title}ів…`} /></label>}{groupsLoading && <div className="campaign-loading"><LoaderCircle className="spin" size={19} /> Завантажуємо групи…</div>}{!groupsLoading && !groupId && <div className="stream-empty-line">Оберіть групу або «Усі групи».</div>}{assetsLoading && <div className="campaign-loading"><LoaderCircle className="spin" size={19} /> Завантажуємо {title}и…</div>}{!assetsLoading && groupId && <div className="asset-picker-list">{visible.length === 0 && <div className="stream-empty-line">У цій групі нічого не знайдено.</div>}{visible.map((asset) => { const selected = selectedIds.has(String(asset.id)); return <button type="button" key={asset.id} className={`asset-picker-item ${selected ? "selected" : ""}`} onClick={() => onToggle(asset)}><span><strong>{asset.name}</strong><small>ID {asset.id}</small></span>{selected ? <Minus size={17} /> : <Plus size={17} />}</button>; })}</div>}</div></div></div>;
}
