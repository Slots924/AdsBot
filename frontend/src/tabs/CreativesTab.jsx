import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { UiButton, UiModal } from "../components/shared-ui/index.js";
import { unwrap } from "../lib/api.js";
import "../styles/creatives.css";

const flagRoot = `${import.meta.env.BASE_URL}flags/`;

export default function CreativesTab({ showToast }) {
    const [items, setItems] = useState([]);
    const [countries, setCountries] = useState([]);
    const [selected, setSelected] = useState("");
    const [geo, setGeo] = useState("");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [reading, setReading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const deleteLock = useRef(false);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [text, setText] = useState("");
    const [comments, setComments] = useState("[]");
    const [baseline, setBaseline] = useState({ text: "", comments: "[]" });
    const [error, setError] = useState("");
    const version = useRef(0);
    const item = items.find((entry) => entry.name === selected);
    const dirty = text !== baseline.text || comments !== baseline.comments;
    const busy = saving || deleting || Boolean(deleteTarget);
    const countryName = (code) => countries.find((country) => country.code === code)?.name || code;
    const filtered = useMemo(() => items.filter((entry) => entry.name.toLowerCase().includes(search.trim().toLowerCase())), [items, search]);

    async function load() {
        setLoading(true);
        setError("");
        try {
            const [next, catalog] = await Promise.all([unwrap(window.adsBot.getCreatives()), unwrap(window.adsBot.getCountries())]);
            setItems(next);
            setCountries(catalog);
        } catch (failure) { setError(failure.message); }
        finally { setLoading(false); }
    }

    useEffect(() => { load(); return () => { version.current += 1; }; }, []);

    const canLeave = () => !dirty || window.confirm("Є незбережені зміни. Відкинути їх?");

    async function select(next, nextGeo = "", afterDelete = false) {
        if (!afterDelete && (busy || !canLeave())) return;
        const request = ++version.current;
        setCreating(false);
        setSelected(next.name);
        setName(next.name);
        setGeo(nextGeo);
        setText("");
        setComments("[]");
        setBaseline({ text: "", comments: "[]" });
        setError("");
        setReading(true);
        try {
            let value = { text: "", comments: "[]" };
            if (nextGeo) {
                const result = await unwrap(window.adsBot.getCreativeVariant(next.name, nextGeo));
                value = { text: result.creative, comments: JSON.stringify(result.comments, null, 2) };
            } else if (next.hasOriginal) {
                const result = await unwrap(window.adsBot.getCreativeOriginal(next.name));
                value.text = result.text;
            }
            if (version.current !== request) return;
            setText(value.text);
            setComments(value.comments);
            setBaseline(value);
        } catch (failure) { if (version.current === request) setError(failure.message); }
        finally { if (version.current === request) setReading(false); }
    }

    function startCreate() {
        if (busy || !canLeave()) return;
        version.current += 1;
        setReading(false);
        setCreating(true);
        setSelected("");
        setName("");
        setGeo("");
        setText("");
        setComments("[]");
        setBaseline({ text: "", comments: "[]" });
        setError("");
    }

    async function save(event) {
        event.preventDefault();
        if (busy) return;
        setSaving(true);
        setError("");
        try {
            const savedName = name.trim();
            if (geo) {
                let parsed;
                try { parsed = JSON.parse(comments); }
                catch { throw new Error("Коментарі містять невалідний JSON"); }
                await unwrap(window.adsBot.saveCreativeVariant({ name: selected, geo, creative: { creative: text, comments: parsed } }));
            } else {
                await unwrap(window.adsBot.saveCreativeOriginal({ name: savedName, text, create: creating || !item?.hasOriginal }));
            }
            setBaseline({ text, comments });
            setCreating(false);
            setSelected(savedName);
            setName(savedName);
            showToast?.("Креатив збережено", "success");
            await load();
        } catch (failure) { setError(failure.message); }
        finally { setSaving(false); }
    }

    function clearEditor() {
        version.current += 1;
        setReading(false);
        setCreating(false);
        setSelected("");
        setName("");
        setGeo("");
        setText("");
        setComments("[]");
        setBaseline({ text: "", comments: "[]" });
    }

    async function remove() {
        if (!deleteTarget || deleteLock.current) return;
        deleteLock.current = true;
        setDeleting(true);
        setError("");
        const target = deleteTarget;
        let failure;
        try {
            const method = target.all ? "deleteCreative" : target.geo ? "deleteCreativeVariant" : "deleteCreativeOriginal";
            await unwrap(window.adsBot[method]({ name: target.name, ...(target.geo ? { geo: target.geo } : {}) }));
        } catch (error) { failure = error; }
        try {
            const next = await unwrap(window.adsBot.getCreatives());
            setItems(next);
            if (target.name === selected) {
                const remaining = next.find((entry) => entry.name === selected);
                if (!remaining) clearEditor();
                else if (!failure) await select(remaining, remaining.hasOriginal ? "" : remaining.countries[0], true);
                else if (geo ? !remaining.countries.includes(geo) : !remaining.hasOriginal) {
                    // Зберігаємо незбережений текст, якщо його файл не вдалося видалити.
                    await select(remaining, remaining.hasOriginal ? "" : remaining.countries[0], true);
                }
            }
            if (!failure) showToast?.(target.all ? "Креатив і всі мовні версії видалено" : "Версію креативу видалено", "success");
        } catch (error) { failure = failure || error; }
        if (failure) setError(failure.message);
        setDeleteTarget(null);
        setDeleting(false);
        deleteLock.current = false;
    }

    return <section className="creatives-tab">
        <header className="creatives-header">
            <div><h1>Креативи</h1><p>Оригінали та готові версії для країн</p></div>
            <div className="creatives-actions">
                <button className="icon-button" aria-label="Оновити креативи" disabled={loading || busy} onClick={load}><RefreshCw size={16}/></button>
                <button className="primary-button" onClick={startCreate} disabled={busy}><Plus size={16}/>Додати креатив</button>
            </div>
        </header>
        {error && <div className="creatives-error" role="alert">{error}</div>}
        <div className="creatives-workspace">
            <aside className="creatives-list">
                <label className="creatives-search"><Search size={16}/><input aria-label="Пошук креативів" placeholder="Пошук за назвою…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
                <div className="creatives-list-caption">Усі креативи <span>{items.length}</span></div>
                <div className="creatives-list-scroll" aria-busy={loading}>
                    {loading && !items.length ? <p className="creatives-empty">Завантаження…</p> : filtered.map((entry) => <div key={entry.name} className="creative-list-row"><button disabled={busy} className={`creative-list-item ${selected === entry.name ? "active" : ""}`} onClick={() => select(entry)}>
                        <FileText size={18}/><span><strong>{entry.name}</strong><small>{entry.countries.length} країн · {entry.hasOriginal ? "є оригінал" : "без оригіналу"}</small></span>
                    </button><button type="button" className="icon-button creative-delete" aria-label={`Видалити весь креатив ${entry.name}`} title="Видалити весь креатив" disabled={busy || loading || reading} onClick={() => setDeleteTarget({ name: entry.name, all: true })}><Trash2 size={16}/></button></div>)}
                    {!loading && !filtered.length && <p className="creatives-empty">{search ? "Нічого не знайдено" : "Креативів ще немає. Додайте перший оригінал."}</p>}
                </div>
            </aside>
            <div className="creatives-detail">
                {!selected && !creating ? <div className="creatives-placeholder"><FileText size={32}/><h2>Виберіть креатив</h2><p>Перегляньте оригінал і версії для країн<br/>або додайте новий креатив.</p></div> : <>
                    <div className="creative-detail-heading"><h2>{creating ? "Новий креатив" : selected}</h2>{dirty && <span>Незбережені зміни</span>}</div>
                    {!creating && <div className="creative-versions" aria-label="Версії креативу">
                        <button disabled={busy} className={!geo ? "active" : ""} onClick={() => select(item)}><FileText size={14}/>Оригінал</button>
                        {item?.countries.map((code) => <button key={code} disabled={busy} className={geo === code ? "active" : ""} onClick={() => select(item, code)} title={countryName(code)}><img src={`${flagRoot}${code.toLowerCase()}.svg`} alt=""/>{code}</button>)}
                    </div>}
                    {!creating && !item?.countries.length && <p className="creative-country-note"><Globe2 size={15}/>Готових версій для країн ще немає.</p>}
                    {reading ? <p className="creatives-empty" role="status">Завантаження креативу…</p> : <form className="creative-editor" onSubmit={save}>
                        {creating && <label>Назва<input autoFocus required maxLength={100} pattern="[A-Za-z0-9_-]+" placeholder="Наприклад, 203" value={name} disabled={busy} onChange={(event) => setName(event.target.value)}/><small>Латинські літери, цифри, дефіс або підкреслення.</small></label>}
                        <label className="creative-text-label">{geo ? `Текст · ${countryName(geo)} (${geo})` : "Текст оригіналу"}<textarea required={!geo} value={text} disabled={busy} placeholder="Введіть текст креативу…" onChange={(event) => setText(event.target.value)}/></label>
                        {geo && <details className="creative-comments"><summary>Коментарі · редагування JSON</summary><textarea aria-label="Коментарі JSON" value={comments} disabled={busy} spellCheck={false} onChange={(event) => setComments(event.target.value)}/></details>}
                        <footer><small>{geo ? "Зміни збережуться лише для вибраної країни." : "Редагування оригіналу не оновлює готові версії для країн."}</small><div className="creatives-actions">{!creating && (geo || item?.hasOriginal) && <button type="button" className="creative-delete" disabled={busy || loading} onClick={() => setDeleteTarget({ name: selected, geo })}><Trash2 size={15}/>Видалити</button>}<button className="primary-button" disabled={busy || (!dirty && !creating)}><Save size={15}/>{saving ? "Збереження…" : "Зберегти"}</button></div></footer>
                    </form>}
                </>}
            </div>
        </div>
        {deleteTarget && <UiModal title={deleteTarget.all ? "Видалити весь креатив" : "Видалити версію креативу"} onClose={() => { if (!deleteLock.current) setDeleteTarget(null); }}>
            <p>{deleteTarget.all ? `Видалити креатив “${deleteTarget.name}”? Буде видалено оригінал і всі мовні версії. Цю дію неможливо скасувати.` : `Видалити ${deleteTarget.geo ? `мовну версію ${deleteTarget.geo}` : "оригінал"} креативу “${deleteTarget.name}”? ${deleteTarget.geo ? "Інші версії залишаться." : "Усі мовні версії залишаться."} Цю дію неможливо скасувати.`}</p>
            {deleteTarget.name === selected && dirty && <p>Незбережені зміни буде втрачено.</p>}
            <div className="creatives-actions"><UiButton disabled={deleting} onClick={() => setDeleteTarget(null)}>Скасувати</UiButton><UiButton variant="danger" disabled={deleting} onClick={remove}>{deleting ? "Видалення…" : deleteTarget.all ? "Видалити все" : "Видалити"}</UiButton></div>
        </UiModal>}
    </section>;
}
