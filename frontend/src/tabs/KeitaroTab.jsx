import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Clipboard, GripVertical, LoaderCircle, MoveRight, Plus, RefreshCw, Replace, Settings2 } from "lucide-react";

import KeitaroCampaignCreateModal from "../components/KeitaroCampaignCreateModal.jsx";
import KeitaroDateRangePicker from "../components/KeitaroDateRangePicker.jsx";
import KeitaroMoveDialog from "../components/KeitaroMoveDialog.jsx";
import { GrayButton, GrayModal, GraySearch, GraySelect } from "../components/gray-ui/index.js";
import { errorDetails, unwrap } from "../lib/api.js";
import { formatKeitaroValue, keitaroColumns, keitaroPageSizes, sortKeitaroCampaigns, summarizeKeitaroRows, visibleKeitaroColumns } from "../lib/keitaro.js";


const emptyCampaignStats = {
    clicks: 0, uniqueClicks: 0, bots: 0, conversions: 0, sales: 0, leads: 0,
    rejected: 0, cr: 0, cost: 0, revenue: 0, profit: 0, roi: 0, epc: 0, cpc: 0,
};


function matchesSearch(campaign, query) {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${campaign.id} ${campaign.name} ${campaign.groupName}`.toLocaleLowerCase().includes(needle);
}


function campaignFieldValue(campaign, columnId) {
    if (columnId === "group") return campaign.groupName || "";
    return campaign[columnId];
}


function summaryValue(column, summary, count) {
    if (column.id === "name") return "Разом";
    if (column.id === "id") return count;
    if (["group", "state"].includes(column.id)) return "—";
    return formatKeitaroValue(column, summary[column.id] ?? 0);
}


export default function KeitaroTab({
    availableGroupIds = [], search = "", onSearchChange = () => {},
    selectedGroupId = "all", onSelectedGroupIdChange = () => {},
    datePreset = "today", onDatePresetChange = () => {},
    sort = { column: "clicks", direction: "desc" }, onSortChange = () => {},
    columnOrder = keitaroColumns.map((column) => column.id), onColumnOrderChange = () => {},
    columnWidths = {}, onColumnWidthsChange = () => {},
    visibleColumns = ["id", "name", "clicks", "conversions", "revenue"], onVisibleColumnsChange = () => {},
    pageSize = 50, onPageSizeChange = () => {}, onError = () => {}, showToast = () => {},
}) {
    const [groups, setGroups] = useState([]);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsError, setStatsError] = useState("");
    const [error, setError] = useState("");
    const [selectedIds, setSelectedIds] = useState([]);
    const [page, setPage] = useState(1);
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);
    const [moveModalOpen, setMoveModalOpen] = useState(false);
    const [pixelModalOpen, setPixelModalOpen] = useState(false);
    const [campaignCreateOpen, setCampaignCreateOpen] = useState(false);
    const [dateRange, setDateRange] = useState(null);
    const requestSequence = useRef(0);
    const columnsRef = useRef(null);
    const dragColumn = useRef("");
    const resizeState = useRef(null);

    const availableSet = useMemo(() => new Set(availableGroupIds.map(String)), [availableGroupIds]);
    const availableGroups = useMemo(() => groups.filter((group) => availableSet.has(String(group.id))), [groups, availableSet]);
    const groupOptions = useMemo(() => [{ id: "all", name: "Усі доступні" }, ...availableGroups], [availableGroups]);
    const columns = useMemo(() => visibleKeitaroColumns(columnOrder, visibleColumns), [columnOrder, visibleColumns]);
    const filtered = useMemo(() => sortKeitaroCampaigns(campaigns.filter((item) => matchesSearch(item, search)), sort), [campaigns, search, sort]);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pageStart = (currentPage - 1) * pageSize;
    const paged = filtered.slice(pageStart, pageStart + pageSize);
    const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
    const allVisibleSelected = paged.length > 0 && paged.every((item) => selectedSet.has(String(item.id)));
    const summaryRows = selectedIds.length > 0 ? filtered.filter((item) => selectedSet.has(String(item.id))) : paged;
    const summary = useMemo(() => summarizeKeitaroRows(summaryRows), [summaryRows]);
    const gridTemplate = ["36px", ...columns.map((column) => `${columnWidths[column.id] || column.width}px`)].join(" ");

    const loadGroups = async () => {
        try { setGroups(await unwrap(window.adsBot.getKeitaroCampaignGroups())); }
        catch (loadError) { onError({ ...errorDetails(loadError), title: "Не вдалося завантажити групи Keitaro" }); }
    };

    const loadCampaigns = async (forceRefresh = false) => {
        const sequence = ++requestSequence.current;
        setLoading(true); setStatsLoading(false); setStatsError(""); setError("");
        try {
            const result = await unwrap(window.adsBot.getKeitaroCampaignsList({ groupId: selectedGroupId, datePreset, dateRange, availableGroupIds, forceRefresh }));
            if (sequence !== requestSequence.current) return;
            setCampaigns((result.campaigns ?? []).map((item) => ({ ...item, ...emptyCampaignStats })));
            setSelectedIds([]); setLoading(false); setStatsLoading(true);
            try {
                const stats = await unwrap(window.adsBot.getKeitaroCampaignStats({ selectedGroupIds: result.selectedGroupIds ?? [], datePreset, dateRange }));
                if (sequence !== requestSequence.current) return;
                const statsById = new Map((stats ?? []).map((item) => [String(item.id), item]));
                setCampaigns((current) => current.map((item) => ({ ...item, ...(statsById.get(String(item.id)) ?? {}) })));
            } catch (statsLoadError) {
                if (sequence === requestSequence.current) setStatsError(`Статистику не завантажено: ${statsLoadError.message}`);
            } finally { if (sequence === requestSequence.current) setStatsLoading(false); }
        } catch (loadError) {
            if (sequence !== requestSequence.current) return;
            setCampaigns([]); setError(loadError.message);
            onError({ ...errorDetails(loadError), title: "Не вдалося завантажити кампанії Keitaro" });
        } finally { if (sequence === requestSequence.current) setLoading(false); }
    };

    useEffect(() => { loadGroups(); }, []);
    useEffect(() => { setPage(1); }, [search, selectedGroupId, datePreset, dateRange?.from, dateRange?.to, pageSize, sort.column, sort.direction]);
    useEffect(() => { if (selectedGroupId !== "all" && !availableSet.has(String(selectedGroupId))) onSelectedGroupIdChange("all"); }, [availableSet, selectedGroupId, onSelectedGroupIdChange]);
    useEffect(() => {
        if (availableGroupIds.length === 0) { setCampaigns([]); setSelectedIds([]); return; }
        loadCampaigns();
    }, [selectedGroupId, datePreset, dateRange?.from, dateRange?.to, availableGroupIds.join("|")]);
    useEffect(() => {
        const close = (event) => { if (!columnsRef.current?.contains(event.target)) setColumnsOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);
    useEffect(() => {
        const move = (event) => {
            const current = resizeState.current;
            if (!current) return;
            onColumnWidthsChange({ ...columnWidths, [current.columnId]: Math.min(640, Math.max(64, current.startWidth + event.clientX - current.startX)) });
        };
        const stop = () => { resizeState.current = null; };
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", stop);
        return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); };
    }, [columnWidths, onColumnWidthsChange]);

    const toggleSort = (column) => onSortChange({ column, direction: sort.column === column && sort.direction === "desc" ? "asc" : "desc" });
    const toggleRow = (id) => setSelectedIds((current) => current.includes(String(id)) ? current.filter((item) => item !== String(id)) : [...current, String(id)]);
    const toggleAll = () => {
        const ids = paged.map((item) => String(item.id));
        setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
    };
    const moveColumn = (fromId, toId) => {
        if (!fromId || fromId === toId) return;
        const next = columnOrder.filter((id) => id !== fromId); const index = next.indexOf(toId);
        if (index < 0) return;
        next.splice(index, 0, fromId); onColumnOrderChange(next);
    };
    const toggleColumn = (id) => onVisibleColumnsChange(visibleColumns.includes(id) ? visibleColumns.filter((item) => item !== id) : [...visibleColumns, id]);
    const copyCampaignUrl = async (campaign) => {
        const url = String(campaign.url ?? "").split("?")[0];
        if (!url) { showToast("Keitaro не повернув URL цієї кампанії", "warning"); return; }
        try {
            await navigator.clipboard.writeText(url);
            showToast(`Скопійовано: ${url}`, "success");
        } catch (copyError) {
            onError({ ...errorDetails(copyError), title: "Не вдалося скопіювати URL кампанії" });
        }
    };
    const moveCampaigns = async (groupId) => {
        try {
            const results = await unwrap(window.adsBot.moveKeitaroCampaignsToGroup({ campaignIds: selectedIds, groupId }));
            const failed = results.filter((item) => !item.ok);
            if (failed.length) throw new Error(`Не перенесено: ${failed.length} із ${results.length}`);
            showToast(`Перенесено кампаній: ${results.length}`, "success"); setMoveModalOpen(false); await loadCampaigns(true);
        } catch (moveError) { onError({ ...errorDetails(moveError), title: "Не вдалося перенести кампанії" }); }
    };

    return <motion.section className="kg-report-workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <header className="kg-report-heading"><div><span>Keitaro tracker</span><h1>Кампанії</h1></div><GrayButton variant="primary" onClick={() => setCampaignCreateOpen(true)}><Plus size={16} /> Створити</GrayButton></header>
        <div className="kg-report-toolbar">
            <GraySearch value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Пошук за ID або назвою…" ariaLabel="Пошук кампаній Keitaro" />
            <GraySelect items={groupOptions} value={selectedGroupId} onChange={onSelectedGroupIdChange} placeholder="Оберіть групу" searchPlaceholder="Пошук групи…" ariaLabel="Група кампаній Keitaro" />
            <KeitaroDateRangePicker preset={datePreset} range={dateRange} onPresetChange={onDatePresetChange} onRangeChange={setDateRange} />
            <GrayButton disabled={loading || statsLoading || availableGroupIds.length === 0} onClick={() => loadCampaigns(true)}><RefreshCw className={loading || statsLoading ? "spin" : ""} size={16} /> Оновити</GrayButton>
            <div className="kg-columns-menu" ref={columnsRef}><GrayButton iconOnly aria-label="Колонки таблиці" onClick={() => setColumnsOpen((current) => !current)}><Settings2 size={17} /></GrayButton>{columnsOpen && <div className="kg-columns-popover"><strong>Параметри звіту</strong>{keitaroColumns.map((column) => <label key={column.id}><input type="checkbox" checked={visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} />{column.label}</label>)}</div>}</div>
        </div>
        <div className="kg-bulk-bar"><span>{`Вибрано: ${selectedIds.length}`}</span><GrayButton disabled={selectedIds.length === 0} onClick={() => setMoveModalOpen(true)}><MoveRight size={15} /> Перенести</GrayButton><GrayButton disabled={selectedIds.length === 0} onClick={() => setTemplateModalOpen(true)}><Plus size={15} /> Застосувати шаблон</GrayButton><GrayButton disabled={selectedIds.length === 0} onClick={() => setPixelModalOpen(true)}><Replace size={15} /> Змінити піксель</GrayButton><small className={statsError ? "error" : ""}>{statsLoading ? "Статистика оновлюється…" : statsError}</small></div>
        {availableGroupIds.length === 0 && <div className="kg-report-notice">У налаштуваннях оберіть групи кампаній, з якими можна працювати.</div>}
        <div className="kg-report-table">
            <div className="kg-report-grid kg-report-head" style={{ gridTemplateColumns: gridTemplate }}><label><input type="checkbox" aria-label="Вибрати всі кампанії" checked={allVisibleSelected} disabled={paged.length === 0} onChange={toggleAll} /></label>{columns.map((column) => <div key={column.id} className="kg-report-column" draggable onDragStart={() => { dragColumn.current = column.id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => moveColumn(dragColumn.current, column.id)}><GripVertical className="kg-drag-dots" size={15} aria-hidden="true" /><button type="button" onClick={() => toggleSort(column.id)}>{column.label}{sort.column === column.id ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}</button><span className="kg-column-resizer" onPointerDown={(event) => { event.preventDefault(); resizeState.current = { columnId: column.id, startX: event.clientX, startWidth: columnWidths[column.id] || column.width }; }} /></div>)}</div>
            <div className="kg-report-scroll">
                {loading && campaigns.length === 0 && <div className="kg-report-state"><LoaderCircle className="spin" size={21} /> Завантажуємо кампанії…</div>}
                {!loading && error && campaigns.length === 0 && <div className="kg-report-state error"><AlertCircle size={22} /><strong>Не вдалося завантажити дані</strong><span>{error}</span></div>}
                {!loading && !error && availableGroupIds.length > 0 && filtered.length === 0 && <div className="kg-report-state">Кампаній за цим фільтром немає.</div>}
                {!loading && paged.map((campaign) => { const checked = selectedSet.has(String(campaign.id)); return <div key={campaign.id} className={`kg-report-grid kg-report-row ${checked ? "selected" : ""}`} style={{ gridTemplateColumns: gridTemplate }}><label><input type="checkbox" checked={checked} onChange={() => toggleRow(campaign.id)} aria-label={`Вибрати кампанію ${campaign.name}`} /></label>{columns.map((column) => <div key={column.id} className={`kg-report-cell ${["number", "money", "percent"].includes(column.type) ? "numeric" : ""}`}>{column.id === "name" ? <span className="kg-campaign-name"><strong title={campaign.name}>{campaign.name}</strong><button type="button" aria-label={`Копіювати URL кампанії ${campaign.name}`} title={campaign.url ? `Копіювати ${campaign.url}` : "URL недоступний"} onClick={() => copyCampaignUrl(campaign)}><Clipboard size={14} /></button></span> : column.id === "state" ? <i className={`kg-status ${campaign.state === "active" ? "active" : "paused"}`}>{formatKeitaroValue(column, campaign.state)}</i> : formatKeitaroValue(column, campaignFieldValue(campaign, column.id))}</div>)}</div>; })}
            </div>
            <div className="kg-report-grid kg-summary-row" style={{ gridTemplateColumns: gridTemplate }}><span />{columns.map((column) => <strong key={column.id} className={["number", "money", "percent"].includes(column.type) ? "numeric" : ""}>{summaryValue(column, summary, summaryRows.length)}</strong>)}</div>
            <footer className="kg-report-pager"><span>{selectedIds.length > 0 ? `Сума вибраних: ${selectedIds.length}` : `Сума на сторінці: ${paged.length}`}</span><div><GrayButton disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Назад</GrayButton><span>Сторінка {currentPage} з {pageCount}</span><GrayButton disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Далі</GrayButton></div><label>На сторінці <select aria-label="Кампаній на сторінці" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{keitaroPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></footer>
        </div>
        {moveModalOpen && <KeitaroMoveDialog title="Перенести кампанії" count={selectedIds.length} groups={groups} onClose={() => setMoveModalOpen(false)} onMove={moveCampaigns} />}
        {templateModalOpen && <ApplyStreamTemplateModal campaignIds={selectedIds} onClose={() => setTemplateModalOpen(false)} onError={onError} showToast={showToast} />}
        {pixelModalOpen && <ChangeCampaignPixelModal campaignIds={selectedIds} onClose={() => setPixelModalOpen(false)} onError={onError} showToast={showToast} onChanged={() => loadCampaigns(true)} />}
        {campaignCreateOpen && <KeitaroCampaignCreateModal onClose={() => setCampaignCreateOpen(false)} onError={onError} showToast={showToast} onCreated={() => loadCampaigns(true)} />}
    </motion.section>;
}


function ChangeCampaignPixelModal({ campaignIds, onClose, onError, showToast, onChanged }) {
    const [pixels, setPixels] = useState([]);
    const [pixelId, setPixelId] = useState("");
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        unwrap(window.adsBot.getKeitaroCampaignSettings()).then((settings) => {
            setPixels([...(settings?.pixels ?? [])].sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "uk-UA", { numeric: true, sensitivity: "base" })));
        }).catch((error) => onError({ ...errorDetails(error), title: "Не вдалося завантажити пікселі Keitaro" })).finally(() => setLoading(false));
    }, []);

    const apply = async () => {
        setApplying(true);
        try {
            const results = await unwrap(window.adsBot.changeKeitaroCampaignPixels({ campaignIds, pixelId }));
            const failed = results.filter((item) => !item.ok);
            if (failed.length) {
                onError({ title: "Піксель змінено не у всіх кампаніях", message: `Успішно: ${results.length - failed.length}. З помилкою: ${failed.length}.`, details: failed.map((item) => `Кампанія ${item.campaignId}: ${item.error}`).join("\n") });
            } else {
                showToast(`Піксель змінено у ${results.length} кампаніях`, "success");
                onClose();
            }
            await onChanged?.();
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося змінити піксель кампаній" });
        } finally {
            setApplying(false);
        }
    };

    return <GrayModal title="Змінити піксель" description={`Вибрано кампаній: ${campaignIds.length}`} onClose={onClose}>
        <div className="kg-apply-template">
            <label><span>Новий піксель</span><GraySelect items={pixels.map((pixel) => ({ id: pixel.id, name: `${pixel.name} · ID ${pixel.pixelId}` }))} value={pixelId} onChange={(value) => setPixelId(String(value))} placeholder="Оберіть піксель" searchPlaceholder="Пошук за назвою або ID…" emptyText="Пікселів не знайдено" ariaLabel="Новий піксель" disabled={loading} /></label>
            <div className="kg-modal-actions"><GrayButton onClick={onClose}>Скасувати</GrayButton><GrayButton variant="primary" disabled={applying || loading || !pixelId} onClick={apply}>{applying && <LoaderCircle className="spin" size={16} />} Змінити</GrayButton></div>
        </div>
    </GrayModal>;
}


function ApplyStreamTemplateModal({ campaignIds, onClose, onError, showToast }) {
    const [templates, setTemplates] = useState([]); const [templateId, setTemplateId] = useState("");
    const [mode, setMode] = useState("replace"); const [replacePosition, setReplacePosition] = useState(2);
    const [loading, setLoading] = useState(true); const [applying, setApplying] = useState(false);
    useEffect(() => { unwrap(window.adsBot.getKeitaroStreamTemplates()).then((items) => setTemplates([...(items ?? [])].sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "uk-UA", { numeric: true, sensitivity: "base" })))).catch((error) => onError({ ...errorDetails(error), title: "Не вдалося завантажити шаблони потоків" })).finally(() => setLoading(false)); }, []);
    const apply = async () => {
        setApplying(true);
        try {
            const results = await unwrap(window.adsBot.applyKeitaroStreamTemplate({ templateId: Number(templateId), campaignIds, mode, replacePosition: mode === "replace" ? Number(replacePosition) : null }));
            const succeeded = results.filter((item) => item.ok).length; const failed = results.length - succeeded;
            if (failed > 0) { onError({ title: "Шаблон застосовано не до всіх кампаній", message: `Успішно: ${succeeded}. З помилкою: ${failed}.`, details: results.filter((item) => !item.ok).map((item) => `Кампанія ${item.campaignId}: ${item.error}`).join("\n") }); return; }
            showToast(`Шаблон застосовано до ${succeeded} кампаній`, "success"); onClose();
        } catch (error) { onError({ ...errorDetails(error), title: "Не вдалося застосувати шаблон потоку" }); }
        finally { setApplying(false); }
    };
    const templateOptions = templates.map((item) => ({ id: item.id, name: `${item.name} · ID ${item.id}` }));
    return <GrayModal title="Застосувати шаблон до кампаній" description={`Вибрано кампаній: ${campaignIds.length}`} onClose={onClose}><div className="kg-apply-template"><label><span>Шаблон потоку</span><GraySelect items={templateOptions} value={templateId} onChange={(value) => setTemplateId(String(value))} placeholder="Оберіть шаблон" searchPlaceholder="Пошук шаблону…" emptyText="Шаблонів не знайдено" ariaLabel="Шаблон потоку" disabled={loading} /></label><label><span>Що зробити</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="add">Додати потік</option><option value="replace">Замінити потік у вибраних кампаніях</option></select></label>{mode === "replace" && <label><span>Номер потоку в кампанії</span><input type="number" min="1" value={replacePosition} onChange={(event) => setReplacePosition(event.target.value)} /></label>}<div className="kg-modal-actions"><GrayButton onClick={onClose}>Скасувати</GrayButton><GrayButton variant="primary" disabled={applying || loading || !templateId || (mode === "replace" && Number(replacePosition) < 1)} onClick={apply}>{applying && <LoaderCircle className="spin" size={16} />} Застосувати</GrayButton></div></div></GrayModal>;
}
