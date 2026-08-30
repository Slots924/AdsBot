import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    AlertCircle,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    X,
} from "lucide-react";

import SearchSelect from "../components/SearchSelect.jsx";
import KeitaroCampaignCreateModal from "../components/KeitaroCampaignCreateModal.jsx";
import { errorDetails, unwrap } from "../lib/api.js";
import {
    formatKeitaroValue,
    keitaroColumns,
    keitaroDatePresets,
    keitaroPageSizes,
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


const emptyCampaignStats = {
    clicks: 0,
    uniqueClicks: 0,
    bots: 0,
    conversions: 0,
    sales: 0,
    leads: 0,
    rejected: 0,
    cr: 0,
    cost: 0,
    revenue: 0,
    profit: 0,
    roi: 0,
    epc: 0,
    cpc: 0,
};


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
    pageSize = 50,
    onPageSizeChange = () => {},
    onError = () => {},
    showToast = () => {},
}) {
    const [groups, setGroups] = useState([]);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsError, setStatsError] = useState("");
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [error, setError] = useState("");
    const [selectedIds, setSelectedIds] = useState([]);
    const [page, setPage] = useState(1);
    const [gearOpen, setGearOpen] = useState(false);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);
    const [campaignCreateOpen, setCampaignCreateOpen] = useState(false);
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
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
    const currentPage = Math.min(page, pageCount);
    const pageStart = (currentPage - 1) * pageSize;
    const paged = filtered.slice(pageStart, pageStart + pageSize);
    const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
    const allVisibleSelected = paged.length > 0
        && paged.every((campaign) => selectedSet.has(String(campaign.id)));
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

    const loadCampaigns = async (forceRefresh = false) => {
        const sequence = requestSequence.current + 1;
        requestSequence.current = sequence;
        setLoading(true);
        setStatsLoading(false);
        setStatsError("");
        setError("");
        setCampaigns([]);
        setSelectedIds([]);
        try {
            const result = await unwrap(window.adsBot.getKeitaroCampaignsList({
                groupId: selectedGroupId,
                datePreset,
                availableGroupIds,
                forceRefresh,
            }));
            if (sequence !== requestSequence.current) return;
            setCampaigns(result.campaigns ?? []);
            setSelectedIds([]);
            setLoading(false);
            setStatsLoading(true);
            try {
                const stats = await unwrap(window.adsBot.getKeitaroCampaignStats({
                    selectedGroupIds: result.selectedGroupIds ?? [],
                    datePreset,
                }));
                if (sequence !== requestSequence.current) return;
                const statsById = new Map((stats ?? []).map((item) => [String(item.id), item]));
                setCampaigns((current) => current.map((campaign) => ({
                    ...campaign,
                    ...emptyCampaignStats,
                    ...(statsById.get(String(campaign.id)) ?? {}),
                })));
            } catch (statsError) {
                if (sequence !== requestSequence.current) return;
                setStatsError(`Статистику не завантажено: ${statsError.message}`);
            } finally {
                if (sequence === requestSequence.current) setStatsLoading(false);
            }
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
        setPage(1);
    }, [search, selectedGroupId, datePreset, pageSize, sort.column, sort.direction]);

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
        const pageIds = paged.map((item) => String(item.id));
        if (allVisibleSelected) {
            const hide = new Set(pageIds);
            setSelectedIds((current) => current.filter((id) => !hide.has(id)));
            return;
        }
        setSelectedIds((current) => [...new Set([...current, ...pageIds])]);
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
                <button type="button" className="primary-button" onClick={() => setCampaignCreateOpen(true)}><Plus size={16} /> Створити кампанію</button>
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
                <span className={`keitaro-stats-status ${statsError ? "error" : ""}`}>
                    {statsLoading ? "Статистика оновлюється…" : statsError}
                </span>
                <button
                    type="button"
                    className="secondary-button"
                    disabled={loading || statsLoading || availableGroupIds.length === 0}
                    onClick={() => loadCampaigns(true)}
                >
                    <RefreshCw className={loading || statsLoading ? "spin" : ""} size={16} />
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
                <button
                    type="button"
                    className="primary-button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setTemplateModalOpen(true)}
                >
                    <Plus size={15} /> Застосувати шаблон
                </button>
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
                    {loading && campaigns.length === 0 && (
                        <div className="campaign-loading">
                            <LoaderCircle className="spin" size={21} />
                            Завантажуємо кампанії Keitaro…
                        </div>
                    )}
                    {!loading && error && campaigns.length === 0 && (
                        <div className="campaign-error">
                            <AlertCircle size={24} />
                            <strong>Не вдалося завантажити дані</strong>
                            <span>{error}</span>
                        </div>
                    )}
                    {!loading && !error && availableGroupIds.length > 0 && filtered.length === 0 && (
                        <div className="campaign-empty">Кампаній за цим фільтром немає.</div>
                    )}
                    {!loading && paged.map((campaign) => {
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
                <div className="keitaro-pager">
                    <span>
                        {filtered.length === 0
                            ? "Кампаній немає"
                            : `${pageStart + 1}–${Math.min(pageStart + paged.length, filtered.length)} з ${filtered.length}`}
                    </span>
                    <div className="keitaro-pager-pages">
                        <button
                            type="button"
                            className="secondary-button"
                            disabled={currentPage <= 1}
                            onClick={() => setPage(currentPage - 1)}
                        >
                            Назад
                        </button>
                        <span>Сторінка {currentPage} з {pageCount}</span>
                        <button
                            type="button"
                            className="secondary-button"
                            disabled={currentPage >= pageCount}
                            onClick={() => setPage(currentPage + 1)}
                        >
                            Далі
                        </button>
                    </div>
                    <label className="keitaro-page-size">
                        На сторінці
                        <select
                            aria-label="Кампаній на сторінці"
                            value={pageSize}
                            onChange={(event) => onPageSizeChange(Number(event.target.value))}
                        >
                            {keitaroPageSizes.map((size) => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>
            {templateModalOpen && (
                <ApplyStreamTemplateModal
                    campaignIds={selectedIds}
                    onClose={() => setTemplateModalOpen(false)}
                    onError={onError}
                    showToast={showToast}
                />
            )}
            {campaignCreateOpen && <KeitaroCampaignCreateModal onClose={() => setCampaignCreateOpen(false)} onError={onError} showToast={showToast} onCreated={() => loadCampaigns(true)} />}
        </motion.section>
    );
}


function ApplyStreamTemplateModal({ campaignIds, onClose, onError, showToast }) {
    const [templates, setTemplates] = useState([]);
    const [templateId, setTemplateId] = useState("");
    const [mode, setMode] = useState("replace");
    const [replacePosition, setReplacePosition] = useState(2);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        unwrap(window.adsBot.getKeitaroStreamTemplates())
            .then((items) => {
                const sorted = [...(items ?? [])].sort((left, right) => (
                    String(left.name ?? "").localeCompare(String(right.name ?? ""), "uk-UA", {
                        numeric: true,
                        sensitivity: "base",
                    })
                ));
                setTemplates(sorted);
            })
            .catch((error) => onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити шаблони потоків",
            }))
            .finally(() => setLoading(false));
    }, []);

    const apply = async () => {
        setApplying(true);
        try {
            const results = await unwrap(window.adsBot.applyKeitaroStreamTemplate({
                templateId: Number(templateId),
                campaignIds,
                mode,
                replacePosition: mode === "replace" ? Number(replacePosition) : null,
            }));
            const succeeded = results.filter((item) => item.ok).length;
            const failed = results.length - succeeded;
            if (failed > 0) {
                onError({
                    title: "Шаблон застосовано не до всіх кампаній",
                    message: `Успішно: ${succeeded}. З помилкою: ${failed}.`,
                    details: results.filter((item) => !item.ok)
                        .map((item) => `Кампанія ${item.campaignId}: ${item.error}`).join("\n"),
                });
                return;
            }
            showToast(`Шаблон застосовано до ${succeeded} кампаній`, "success");
            onClose();
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося застосувати шаблон потоку" });
        } finally {
            setApplying(false);
        }
    };

    return (
        <div className="stream-editor-overlay" role="dialog" aria-modal="true" aria-label="Застосувати шаблон до кампаній">
            <div className="apply-stream-modal">
                <header><div><h2>Застосувати шаблон</h2><p>Вибрано кампаній: {campaignIds.length}</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></header>
                <div className="apply-stream-body">
                    <label className="stream-field"><span>Шаблон потоку</span><SearchSelect items={templates} value={templateId} onChange={(value) => setTemplateId(String(value))} getId={(item) => item.id} getTitle={(item) => item.name} getSubtitle={(item) => `ID ${item.id}`} placeholder="Оберіть шаблон" searchPlaceholder="Пошук шаблону…" emptyText="Шаблонів не знайдено" ariaLabel="Шаблон потоку" disabled={loading} /></label>
                    <label className="stream-field"><span>Що зробити</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="add">Додати потік</option><option value="replace">Замінити потік у вибраних кампаніях</option></select></label>
                    {mode === "replace" && <label className="stream-field replace-position"><span>Номер потоку в кампанії</span><input type="number" min="1" step="1" value={replacePosition} onChange={(event) => setReplacePosition(event.target.value)} /><small>Наприклад, 1 — перший потік у кожній вибраній кампанії. Його позиція збережеться.</small></label>}
                    {mode === "replace" && <div className="stream-warning">Параметри потоку з цим номером будуть замінені даними шаблону в кожній вибраній кампанії.</div>}
                </div>
                <footer><button type="button" className="secondary-button" onClick={onClose}>Скасувати</button><button type="button" className="primary-button" disabled={applying || loading || !templateId || (mode === "replace" && Number(replacePosition) < 1)} onClick={apply}>{applying && <LoaderCircle className="spin" size={16} />} Застосувати</button></footer>
            </div>
        </div>
    );
}


function campaignFieldValue(campaign, columnId) {
    if (columnId === "group") return campaign.groupName || "";
    return campaign[columnId];
}
