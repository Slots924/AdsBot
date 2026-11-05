import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Search, X } from "lucide-react";
import { errorDetails, unwrap } from "../lib/api.js";
import CrmCampaignCreateModal from "./CrmCampaignCreateModal.jsx";

export default function CrmCampaignPickerModal({ geo = "", creativeName = "", onSelect, onClose, onError }) {
    const [campaigns, setCampaigns] = useState([]);
    const [query, setQuery] = useState(geo);
    const [selected, setSelected] = useState("");
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const load = async () => {
        setLoading(true);
        try { setCampaigns(await unwrap(window.adsBot.getCrmCampaigns())); }
        catch (error) { onError?.({ ...errorDetails(error), title: "Не вдалося завантажити кампанії CRM" }); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);
    const visible = useMemo(() => campaigns.filter(c => `${c.name} ${c.id} ${c.url}`.toLowerCase().includes(query.trim().toLowerCase())), [campaigns, query]);
    const selectedCampaign = campaigns.find(c => c.id === selected);
    return <>
        <div className="overlay" onMouseDown={onClose}><div className="modal keitaro-picker-modal" onMouseDown={event => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={onClose} aria-label="Закрити"><X size={17} /></button>
            <div className="modal-icon"><Search /></div><span className="eyebrow">CRM</span><h2>Вибрати кампанію</h2>
            <label className="field"><span>Пошук</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="GEO, назва або ID" /></label>
            <div className="keitaro-picker-list">
                {loading && <div className="campaign-loading"><LoaderCircle className="spin" size={18} /> Завантажуємо кампанії…</div>}
                {!loading && !visible.length && <div className="ad-list-empty">Кампаній не знайдено.</div>}
                {visible.map(c => <div key={c.id} className={`keitaro-picker-row ${selected === c.id ? "selected" : ""}`}>
                    <button type="button" className="keitaro-picker-select" onClick={() => setSelected(c.id)}><strong>{c.name}</strong><span>{c.id}</span><small>{c.url || "Короткого посилання немає"}</small></button>
                </div>)}
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setCreating(true)}><Plus size={16} /> Створити кампанію</button><span className="action-spacer" /><button type="button" className="primary-button" disabled={!selectedCampaign?.url} onClick={() => onSelect(selectedCampaign.url)}>Обрати</button></div>
        </div></div>
        {creating && <CrmCampaignCreateModal initialGeo={geo} initialCreative={creativeName} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} onError={onError} />}
    </>;
}
