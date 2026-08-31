import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, GripVertical, Layers3, LoaderCircle, MoveRight, RefreshCw, Settings2 } from "lucide-react";

import KeitaroDateRangePicker from "../components/KeitaroDateRangePicker.jsx";
import KeitaroMoveDialog from "../components/KeitaroMoveDialog.jsx";
import { GrayButton, GraySearch, GraySelect } from "../components/gray-ui/index.js";
import { errorDetails, unwrap } from "../lib/api.js";
import {
    defaultKeitaroOfferColumns,
    formatKeitaroValue,
    groupKeitaroOffers,
    keitaroOfferColumns,
    keitaroPageSizes,
    sortKeitaroCampaigns,
    summarizeKeitaroRows,
    visibleColumnsFrom,
} from "../lib/keitaro.js";


function matchesSearch(offer, query) {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${offer.id} ${offer.name} ${offer.groupName} ${offer.affiliateNetworkName}`
        .toLocaleLowerCase().includes(needle);
}


function offerValue(offer, columnId) {
    if (columnId === "group") return offer.groupName;
    return offer[columnId];
}


function totalValue(column, summary, count) {
    if (column.id === "name") return "Разом";
    if (column.id === "id") return count;
    if (["affiliateNetworkName", "group", "state"].includes(column.id)) return "—";
    return formatKeitaroValue(column, summary[column.id] ?? 0);
}


export default function KeitaroOffersTab({
    grouped = false,
    onGroupedChange = () => {},
    onError = () => {},
    showToast = () => {},
}) {
    const [offers, setOffers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [search, setSearch] = useState("");
    const [groupId, setGroupId] = useState("all");
    const [datePreset, setDatePreset] = useState("today");
    const [dateRange, setDateRange] = useState(null);
    const [sort, setSort] = useState({ column: "clicks", direction: "desc" });
    const [columnOrder, setColumnOrder] = useState(keitaroOfferColumns.map((column) => column.id));
    const [visibleColumns, setVisibleColumns] = useState(defaultKeitaroOfferColumns);
    const [columnWidths, setColumnWidths] = useState({});
    const [selectedIds, setSelectedIds] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState([]);
    const menuRef = useRef(null);
    const dragColumn = useRef("");
    const resizeState = useRef(null);

    const columns = useMemo(() => visibleColumnsFrom(keitaroOfferColumns, columnOrder, visibleColumns), [columnOrder, visibleColumns]);
    const filteredOffers = useMemo(() => offers.filter((offer) => matchesSearch(offer, search)), [offers, search]);
    const displayRows = useMemo(() => sortKeitaroCampaigns(grouped ? groupKeitaroOffers(filteredOffers) : filteredOffers, sort), [filteredOffers, grouped, sort]);
    const pageCount = Math.max(1, Math.ceil(displayRows.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pageStart = (currentPage - 1) * pageSize;
    const paged = displayRows.slice(pageStart, pageStart + pageSize);
    const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
    const idsForRow = (row) => row.sourceIds ?? [String(row.id)];
    const allVisibleIds = [...new Set(paged.flatMap(idsForRow))];
    const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedSet.has(String(id)));
    const selectedOffers = offers.filter((offer) => selectedSet.has(String(offer.id)));
    const summaryRows = selectedIds.length > 0 ? selectedOffers : paged.flatMap((row) => row.children ?? [row]);
    const summary = useMemo(() => summarizeKeitaroRows(summaryRows), [summaryRows]);
    const gridTemplate = ["36px", ...columns.map((column) => `${columnWidths[column.id] || column.width}px`)].join(" ");
    const groupOptions = [{ id: "all", name: "Усі групи" }, ...groups];

    const load = async (forceRefresh = false) => {
        setLoading(true); setError("");
        try {
            const result = await unwrap(window.adsBot.getKeitaroOffersReport({ groupId, datePreset, dateRange, forceRefresh }));
            setOffers(result.offers ?? []); setGroups(result.groups ?? []); setSelectedIds([]);
        } catch (loadError) {
            setOffers([]); setError(loadError.message);
            onError({ ...errorDetails(loadError), title: "Не вдалося завантажити офери Keitaro" });
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [groupId, datePreset, dateRange?.from, dateRange?.to]);
    useEffect(() => { setPage(1); }, [search, groupId, grouped, datePreset, dateRange?.from, dateRange?.to, pageSize, sort.column, sort.direction]);
    useEffect(() => {
        const close = (event) => { if (!menuRef.current?.contains(event.target)) setColumnsOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);
    useEffect(() => {
        const move = (event) => {
            const current = resizeState.current;
            if (!current) return;
            setColumnWidths((widths) => ({ ...widths, [current.columnId]: Math.min(640, Math.max(64, current.startWidth + event.clientX - current.startX)) }));
        };
        const stop = () => { resizeState.current = null; };
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", stop);
        return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); };
    }, []);

    const toggleSort = (column) => setSort({ column, direction: sort.column === column && sort.direction === "desc" ? "asc" : "desc" });
    const toggleRow = (row) => {
        const ids = idsForRow(row).map(String); const checked = ids.every((id) => selectedSet.has(id));
        setSelectedIds((current) => checked ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
    };
    const toggleAll = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !allVisibleIds.includes(id)) : [...new Set([...current, ...allVisibleIds])]);
    const moveColumn = (fromId, toId) => {
        if (!fromId || fromId === toId) return;
        const next = columnOrder.filter((id) => id !== fromId); const index = next.indexOf(toId);
        if (index < 0) return;
        next.splice(index, 0, fromId); setColumnOrder(next);
    };
    const toggleColumn = (id) => setVisibleColumns((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    const toggleExpanded = (id) => setExpandedGroups((current) => current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]);
    const moveOffers = async (targetGroupId) => {
        try {
            const results = await unwrap(window.adsBot.moveKeitaroOffersToGroup({ offerIds: selectedIds, groupId: targetGroupId }));
            const failed = results.filter((item) => !item.ok);
            if (failed.length) throw new Error(`Не перенесено: ${failed.length} із ${results.length}`);
            showToast(`Перенесено оферів: ${results.length}`, "success"); setMoveOpen(false); await load(true);
        } catch (moveError) { onError({ ...errorDetails(moveError), title: "Не вдалося перенести офери" }); }
    };

    return <section className="kg-report-workspace kg-offers-workspace">
        <header className="kg-report-heading"><div><span>Keitaro tracker</span><h1>Офери</h1></div><label className={`kg-grouping-switch ${grouped ? "active" : ""}`}><input type="checkbox" role="switch" checked={grouped} onChange={(event) => onGroupedChange(event.target.checked)} /><span className="kg-switch-track" aria-hidden="true"><i /></span><Layers3 size={17} /><span>Групувати офери</span></label></header>
        <div className="kg-report-toolbar">
            <GraySearch value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук офера, ID або мережі…" ariaLabel="Пошук оферів Keitaro" />
            <GraySelect items={groupOptions} value={groupId} onChange={setGroupId} searchPlaceholder="Пошук групи…" ariaLabel="Група оферів Keitaro" />
            <KeitaroDateRangePicker preset={datePreset} range={dateRange} onPresetChange={setDatePreset} onRangeChange={setDateRange} />
            <GrayButton disabled={loading} onClick={() => load(true)}><RefreshCw className={loading ? "spin" : ""} size={16} /> Оновити</GrayButton>
            <div className="kg-columns-menu" ref={menuRef}><GrayButton iconOnly aria-label="Колонки оферів" onClick={() => setColumnsOpen((current) => !current)}><Settings2 size={17} /></GrayButton>{columnsOpen && <div className="kg-columns-popover"><strong>Параметри звіту</strong>{keitaroOfferColumns.map((column) => <label key={column.id}><input type="checkbox" checked={visibleColumns.includes(column.id)} onChange={() => toggleColumn(column.id)} />{column.label}</label>)}</div>}</div>
        </div>
        <div className="kg-bulk-bar"><span>Вибрано оферів: <strong>{selectedIds.length}</strong></span><GrayButton disabled={selectedIds.length === 0} onClick={() => setMoveOpen(true)}><MoveRight size={15} /> Перенести</GrayButton><small>{grouped ? "Групування: група + GEO + [назва] + мережа" : "Кожен ленд показано окремо"}</small></div>
        <div className="kg-report-table">
            <div className="kg-report-grid kg-report-head" style={{ gridTemplateColumns: gridTemplate }}><label><input type="checkbox" aria-label="Вибрати всі офери" checked={allVisibleSelected} disabled={paged.length === 0} onChange={toggleAll} /></label>{columns.map((column) => <div key={column.id} className="kg-report-column" draggable onDragStart={() => { dragColumn.current = column.id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => moveColumn(dragColumn.current, column.id)}><GripVertical className="kg-drag-dots" size={15} /><button type="button" onClick={() => toggleSort(column.id)}>{column.label}{sort.column === column.id ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}</button><span className="kg-column-resizer" onPointerDown={(event) => { event.preventDefault(); resizeState.current = { columnId: column.id, startX: event.clientX, startWidth: columnWidths[column.id] || column.width }; }} /></div>)}</div>
            <div className="kg-report-scroll">
                {loading && offers.length === 0 && <div className="kg-report-state"><LoaderCircle className="spin" size={21} /> Завантажуємо офери…</div>}
                {!loading && error && <div className="kg-report-state error"><AlertCircle size={22} /><strong>Не вдалося завантажити дані</strong><span>{error}</span></div>}
                {!loading && !error && displayRows.length === 0 && <div className="kg-report-state">Оферів за цим фільтром немає.</div>}
                {!loading && paged.map((row) => {
                    const ids = idsForRow(row);
                    const checked = ids.every((id) => selectedSet.has(String(id)));
                    const expanded = grouped && expandedGroups.includes(String(row.id));
                    return <Fragment key={row.id}>
                        <div className={`kg-report-grid kg-report-row ${checked ? "selected" : ""} ${grouped ? "grouped-parent" : ""}`} style={{ gridTemplateColumns: gridTemplate }}>
                            <label><input type="checkbox" checked={checked} onChange={() => toggleRow(row)} aria-label={`Вибрати офер ${row.name}`} /></label>
                            {columns.map((column) => <div key={column.id} className={`kg-report-cell ${["number", "money", "percent"].includes(column.type) ? "numeric" : ""}`}>
                                {column.id === "name" ? <div className="kg-offer-name">
                                    {grouped && <button type="button" className="kg-offer-expand" aria-label={`${expanded ? "Згорнути" : "Розгорнути"} групу ${row.name}`} aria-expanded={expanded} onClick={() => toggleExpanded(String(row.id))}><ChevronDown size={17} /></button>}
                                    <span><strong title={row.name}>{row.name}</strong>{grouped && <small>{row.children.length} {row.children.length === 1 ? "офер" : "офери"}</small>}</span>
                                </div> : column.id === "state" ? <i className={`kg-status ${row.state === "active" ? "active" : "paused"}`}>{formatKeitaroValue(column, row.state)}</i> : formatKeitaroValue(column, offerValue(row, column.id))}
                            </div>)}
                        </div>
                        {expanded && row.children.map((child) => {
                            const childChecked = selectedSet.has(String(child.id));
                            return <div key={`${row.id}-${child.id}`} className={`kg-report-grid kg-report-row grouped-child ${childChecked ? "selected" : ""}`} style={{ gridTemplateColumns: gridTemplate }}>
                                <label><input type="checkbox" checked={childChecked} onChange={() => toggleRow(child)} aria-label={`Вибрати підофер ${child.name}`} /></label>
                                {columns.map((column) => <div key={column.id} className={`kg-report-cell ${["number", "money", "percent"].includes(column.type) ? "numeric" : ""}`}>
                                    {column.id === "name" ? <div className="kg-child-offer-name"><i /><span><strong title={child.name}>{child.name}</strong><small>ID {child.id}</small></span></div> : column.id === "state" ? <i className={`kg-status ${child.state === "active" ? "active" : "paused"}`}>{formatKeitaroValue(column, child.state)}</i> : formatKeitaroValue(column, offerValue(child, column.id))}
                                </div>)}
                            </div>;
                        })}
                    </Fragment>;
                })}
            </div>
            <div className="kg-report-grid kg-summary-row" style={{ gridTemplateColumns: gridTemplate }}><span />{columns.map((column) => <strong key={column.id} className={["number", "money", "percent"].includes(column.type) ? "numeric" : ""}>{totalValue(column, summary, summaryRows.length)}</strong>)}</div>
            <footer className="kg-report-pager"><span>{selectedIds.length > 0 ? `Сума вибраних оферів: ${selectedIds.length}` : `Сума на сторінці: ${summaryRows.length}`}</span><div><GrayButton disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Назад</GrayButton><span>Сторінка {currentPage} з {pageCount}</span><GrayButton disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Далі</GrayButton></div><label>На сторінці <select aria-label="Оферів на сторінці" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{keitaroPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></footer>
        </div>
        {moveOpen && <KeitaroMoveDialog title="Перенести офери" count={selectedIds.length} groups={groups} onClose={() => setMoveOpen(false)} onMove={moveOffers} />}
    </section>;
}
