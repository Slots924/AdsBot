import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    AlertCircle,
    LoaderCircle,
    RefreshCw,
    Search,
    Settings2,
} from "lucide-react";

import SearchSelect from "../components/SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";
import {
    formatKeitaroValue,
    keitaroColumns,
    keitaroDatePresets,
    sortKeitaroCampaigns,
    visibleKeitaroColumns,
} from "../lib/keitaro.js";


function matchesSearch(campaign, query) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    return `${campaign.id} ${campaign.name} ${campaign.groupName}`
        .toLocaleLowerCase()
        .includes(needle);
}


export default function KeitaroTab({
    availableGroupIds = [],
    search = "",
    onSearchChange = () => {},
    selectedGroupId = "all",
    onSelectedGroupIdChange = () => {},
    datePreset = "today",
    onDatePresetChange = () => {},
    sort = { column: "clicks", direction: "desc" },
    onSortChange = () => {},
    columnOrder = keitaroColumns.map((column) => column.id),
    onColumnOrderChange = () => {},
    columnWidths = {},
    onColumnWidthsChange = () => {},
    visibleColumns = ["id", "name", "clicks", "conversions", "revenue"],
    onVisibleColumnsChange = () => {},
    onError = () => {},
}) {
    const [groups, setGroups] = useState([]);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [error, setError] = useState("");
    const [selectedIds, setSelectedIds] = useState([]);
    const [gearOpen, setGearOpen] = useState(false);
    const requestSequence = useRef(0);
    const gearRef = useRef(null);
    const dragColumn = useRef("");
    const resizeState = useRef(null);

    const availableSet = useMemo(
        () => new Set(availableGroupIds.map(String)),
        [availableGroupIds]
    );
    const availableGroups = useMemo(
        () => groups.filter((group) => availableSet.has(String(group.id))),
        [groups, availableSet]
    );
    const groupOptions = useMemo(
        () => [{ id: "all", name: "Усі доступні" }, ...availableGroups],
        [availableGroups]
    );
    const columns = useMemo(
        () => visibleKeitaroColumns(columnOrder, visibleColumns),
        [columnOrder, visibleColumns]
    );
    const filtered = useMemo(
        () => sortKeitaroCampaigns(
            campaigns.filter((campaign) => matchesSearch(campaign, search)),
            sort
        ),
        [campaigns, search, sort]
    );
    const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
    const allVisibleSelected = filtered.length > 0
        && filtered.every((campaign) => selectedSet.has(String(campaign.id)));
    const gridTemplate = [
        "36px",
        ...columns.map((column) => `${columnWidths[column.id] || column.width}px`),
    ].join(" ");

    const loadGroups = async () => {
        setGroupsLoading(true);
        try {
            setGroups(await unwrap(window.adsBot.getKeitaroCampaignGroups()));
        } catch (loadError) {
            onError({
                ...errorDetails(loadError),
                title: "Не вдалося завантажити групи Keitaro",
            });
        } finally {
            setGroupsLoading(false);
        }
    };

    const loadCampaigns = async () => {
        const sequence = requestSequence.current + 1;
        requestSequence.current = sequence;
        setLoading(true);
        setError("");
        try {
            const result = await unwrap(window.adsBot.getKeitaroCampaignsReport({
                groupId: selectedGroupId,
                datePreset,
                availableGroupIds,
            }));
            if (sequence !== requestSequence.current) return;
            setCampaigns(result.campaigns ?? []);
            setSelectedIds([]);
        } catch (loadError) {
            if (sequence !== requestSequence.current) return;
            setCampaigns([]);
            setError(loadError.message);
            onError({
                ...errorDetails(loadError),
                title: "Не вдалося завантажити кампанії Keitaro",
            });
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        loadGroups();
    }, []);

    useEffect(() => {
        if (selectedGroupId !== "all" && !availableSet.has(String(selectedGroupId))) {
            onSelectedGroupIdChange("all");
        }
    }, [availableSet, selectedGroupId, onSelectedGroupIdChange]);

    useEffect(() => {
        if (availableGroupIds.length === 0) {
            setCampaigns([]);
            setSelectedIds([]);
            return;
        }
        loadCampaigns();
    }, [selectedGroupId, datePreset, availableGroupIds.join("|")]);

    useEffect(() => {
        const close = (event) => {
            if (!gearRef.current?.contains(event.target)) setGearOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    useEffect(() => {
        const move = (event) => {
            const current = resizeState.current;
            if (!current) return;
            const nextWidth = Math.min(
                640,
                Math.max(64, current.startWidth + (event.clientX - current.startX))
            );
            onColumnWidthsChange({
                ...columnWidths,
                [current.columnId]: nextWidth,
            });
        };
        const stop = () => {
            resizeState.current = null;
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
        return () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
        };
    }, [columnWidths, onColumnWidthsChange]);

    const toggleSort = (column) => {
        onSortChange({
            column,
            direction: sort.column === column && sort.direction === "desc"
                ? "asc"
                : "desc",
        });
    };

    const toggleAll = () => {
        setSelectedIds(allVisibleSelected ? [] : filtered.map((item) => String(item.id)));
    };

    const toggleRow = (id) => {
        const key = String(id);
        setSelectedIds((current) => (
            current.includes(key)
                ? current.filter((item) => item !== key)
                : [...current, key]
        ));
    };

    const moveColumn = (fromId, toId) => {
        if (!fromId || fromId === toId) return;
        const next = columnOrder.filter((id) => id !== fromId);
        const target = next.indexOf(toId);
        if (target < 0) return;
        next.splice(target, 0, fromId);
        onColumnOrderChange(next);
    };

    const toggleColumn = (columnId) => {
        onVisibleColumnsChange(
            visibleColumns.includes(columnId)
                ? visibleColumns.filter((id) => id !== columnId)
                : [...visibleColumns, columnId]
        );
    };

    return (
        <motion.section
            className="keitaro-tab"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
        >
            <div className="keitaro-heading">
                <div>
                    <span className="eyebrow">Keitaro tracker</span>
                    <h1>Keitaro</h1>
                    <p>Кампанії з кліками, конверсіями та доходом за вибраний період.</p>
                </div>
            </div>

            <div className="keitaro-toolbar">
                <label className="keitaro-search">
                    <Search size={16} />
                    <input
                        aria-label="Пошук кампаній Keitaro"
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Пошук за ID або назвою…"
                    />
                </label>
                <div className="campaign-periods">
                    {keitaroDatePresets.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={datePreset === preset.id ? "active" : ""}
                            onClick={() => onDatePresetChange(preset.id)}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <SearchSelect
                    className="keitaro-group-select"
                    items={groupOptions}
                    value={selectedGroupId}
                    onChange={onSelectedGroupIdChange}
                    getId={(item) => item.id}
                    getTitle={(item) => item.name}
                    getSubtitle={(item) => item.id === "all" ? "" : item.id}
                    placeholder="Оберіть групу"
                    searchPlaceholder="Пошук групи…"
                    emptyText="Немає доступних груп"
                    ariaLabel="Група кампаній Keitaro"
                    disabled={availableGroups.length === 0}
                />
                <button
                    type="button"
                    className="secondary-button"
                    disabled={loading || availableGroupIds.length === 0}
                    onClick={loadCampaigns}
                >
                    <RefreshCw className={loading ? "spin" : ""} size={16} />
                    Оновити
                </button>
                <div className="keitaro-gear" ref={gearRef}>
                    <button
                        type="button"
                        className="icon-button"
                        title="Колонки таблиці"
                        aria-label="Колонки таблиці"
                        onClick={() => setGearOpen((current) => !current)}
                    >
                        <Settings2 size={16} />
                    </button>
                    {gearOpen && (
                        <div className="keitaro-gear-menu">
                            <strong>Параметри звіту</strong>
                            {keitaroColumns.map((column) => (
                                <label key={column.id}>
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.includes(column.id)}
                                        onChange={() => toggleColumn(column.id)}
                                    />
                                    {column.label}
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="keitaro-meta">
                <span>Вибрано: {selectedIds.length}</span>
                {groupsLoading && <small>Оновлюємо групи…</small>}
            </div>

            {availableGroupIds.length === 0 && (
                <div className="notice keitaro-notice">
                    У налаштуваннях оберіть групи кампаній, з якими можна працювати.
                </div>
            )}

            <div className="campaign-table-card keitaro-table">
                <div
                    className="campaign-table-head keitaro-grid"
                    style={{ gridTemplateColumns: gridTemplate }}
                >
                    <label>
                        <input
                            type="checkbox"
                            aria-label="Вибрати всі кампанії"
                            checked={allVisibleSelected}
                            disabled={filtered.length === 0}
                            onChange={toggleAll}
                        />
                    </label>
                    {columns.map((column) => (
                        <div
                            key={column.id}
                            className="keitaro-col"
                            draggable
                            onDragStart={() => {
                                dragColumn.current = column.id;
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => moveColumn(dragColumn.current, column.id)}
                        >
                            <button
                                type="button"
                                className="comment-sort"
                                onClick={() => toggleSort(column.id)}
                            >
                                {column.label}
                                {sort.column === column.id
                                    ? (sort.direction === "asc" ? " ▲" : " ▼")
                                    : ""}
                            </button>
                            <span
                                className="keitaro-col-resizer"
                                onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    resizeState.current = {
                                        columnId: column.id,
                                        startX: event.clientX,
                                        startWidth: columnWidths[column.id] || column.width,
                                    };
                                }}
                            />
                        </div>
                    ))}
                </div>
                <div className="keitaro-scroll">
                    {loading && (
                        <div className="campaign-loading">
                            <LoaderCircle className="spin" size={21} />
                            Завантажуємо кампанії Keitaro…
                        </div>
                    )}
                    {!loading && error && (
                        <div className="campaign-error">
                            <AlertCircle size={24} />
                            <strong>Не вдалося завантажити дані</strong>
                            <span>{error}</span>
                        </div>
                    )}
                    {!loading && !error && availableGroupIds.length > 0 && filtered.length === 0 && (
                        <div className="campaign-empty">Кампаній за цим фільтром немає.</div>
                    )}
                    {!loading && filtered.map((campaign) => {
                        const checked = selectedSet.has(String(campaign.id));
                        return (
                            <label
                                key={campaign.id}
                                className={`campaign-row keitaro-grid ${checked ? "selected" : ""}`}
                                style={{ gridTemplateColumns: gridTemplate }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleRow(campaign.id)}
                                    aria-label={`Вибрати кампанію ${campaign.name}`}
                                />
                                {columns.map((column) => (
                                    <span
                                        key={column.id}
                                        className={
                                            column.id === "name"
                                                ? "campaign-name"
                                                : column.id === "state"
                                                ? ""
                                                : "keitaro-metric"
                                        }
                                    >
                                        {column.id === "name" ? (
                                            <strong>{campaign.name}</strong>
                                        ) : column.id === "state" ? (
                                            <i className={`campaign-status ${
                                                campaign.state === "active" ? "active" : "paused"
                                            }`}>
                                                {formatKeitaroValue(column, campaign.state)}
                                            </i>
                                        ) : (
                                            formatKeitaroValue(
                                                column,
                                                campaignFieldValue(campaign, column.id)
                                            )
                                        )}
                                    </span>
                                ))}
                            </label>
                        );
                    })}
                </div>
            </div>
        </motion.section>
    );
}


function campaignFieldValue(campaign, columnId) {
    if (columnId === "group") return campaign.groupName || "";
    return campaign[columnId];
}
