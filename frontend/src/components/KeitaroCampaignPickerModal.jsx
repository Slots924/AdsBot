import { useEffect, useMemo, useState } from "react";
import { Copy, LoaderCircle, Plus, Search, X } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import KeitaroCampaignCreateModal from "./KeitaroCampaignCreateModal.jsx";


export function baseUrl(value) {
    try {
        const url = new URL(String(value ?? "").trim());
        return `${url.origin}${url.pathname}`;
    } catch {
        return String(value ?? "").trim().split("?")[0];
    }
}


export default function KeitaroCampaignPickerModal({
    geo = "",
    creativeName = "",
    availableGroupIds = [],
    onSelect,
    onClose,
    onError,
}) {
    const [campaigns, setCampaigns] = useState([]);
    const [search, setSearch] = useState(geo);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);

    const load = async (forceRefresh = false) => {
        setLoading(true);
        try {
            const result = await unwrap(window.adsBot.getKeitaroCampaignsList({
                groupId: "all",
                availableGroupIds,
                datePreset: "maximum",
                forceRefresh,
            }));
            setCampaigns(result.campaigns ?? []);
        } catch (error) {
            onError?.({ ...errorDetails(error), title: "Не вдалося завантажити кампанії Keitaro" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);
    const visible = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        if (!query) return campaigns;
        return campaigns.filter((campaign) => (
            `${campaign.name} ${campaign.id} ${campaign.url}`
                .toLocaleLowerCase()
                .includes(query)
        ));
    }, [campaigns, search]);
    const selected = campaigns.find((campaign) => String(campaign.id) === selectedId);

    const copyCampaignUrl = async (event, url) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(baseUrl(url));
        } catch {
            // Відсутність доступу до буфера не повинна заважати вибору кампанії.
        }
    };

    return (
        <>
            <div className="overlay" onMouseDown={onClose}>
            <div className="modal keitaro-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
                <button className="modal-close" type="button" onClick={onClose}><X size={17} /></button>
                <div className="modal-icon"><Search /></div>
                <span className="eyebrow">Keitaro</span>
                <h2>Вибрати кампанію</h2>
                <p>Відображаються лише кампанії з груп, дозволених у налаштуваннях.</p>
                <label className="field">
                    <span>Пошук</span>
                    <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="GEO, назва або ID" />
                </label>
                <div className="keitaro-picker-list">
                    {loading && <div className="campaign-loading"><LoaderCircle className="spin" size={18} /> Завантажуємо кампанії…</div>}
                    {!loading && visible.length === 0 && <div className="ad-list-empty">Кампаній не знайдено.</div>}
                    {visible.map((campaign) => (
                        <div key={campaign.id} className={`keitaro-picker-row ${selectedId === String(campaign.id) ? "selected" : ""}`}>
                            <button type="button" className="keitaro-picker-select" onClick={() => setSelectedId(String(campaign.id))}>
                                <strong title={campaign.name}>{campaign.name}</strong>
                                <span title={`${campaign.id} · ${campaign.groupName || "Без групи"}`}>{campaign.id} · {campaign.groupName || "Без групи"}</span>
                                <small title={baseUrl(campaign.url)}>{baseUrl(campaign.url)}</small>
                            </button>
                            <button
                                type="button"
                                className="keitaro-picker-copy"
                                title="Копіювати посилання"
                                aria-label={`Копіювати посилання кампанії ${campaign.name}`}
                                onClick={(event) => copyCampaignUrl(event, campaign.url)}
                            >
                                <Copy size={15} />
                            </button>
                        </div>
                    ))}
                </div>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={() => setCreateOpen(true)}><Plus size={16} /> Створити кампанію</button>
                    <span className="action-spacer" />
                    <button type="button" className="primary-button" disabled={!selected?.url} onClick={() => onSelect(baseUrl(selected.url))}>Обрати</button>
                </div>
            </div>
            </div>
            {createOpen && (
                <KeitaroCampaignCreateModal
                    initialGeo={geo}
                    initialCreativeName={creativeName}
                    onClose={() => setCreateOpen(false)}
                    onError={onError}
                    onCreated={() => load(true)}
                />
            )}
        </>
    );
}
