import { useEffect, useMemo, useState } from "react";
import {
    ArrowLeft,
    ArrowRight,
    RefreshCw,
    Star,
    UserPlus,
} from "lucide-react";

import CreateCommentAccountsModal from "../components/CreateCommentAccountsModal.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";
import {
    sortGroups,
    sortProfiles,
    tagChipStyle,
} from "../lib/commentAccountGroups.js";


function GroupPane({
    side,
    groups,
    favoriteGroupIds,
    groupId,
    onGroupIdChange,
    onToggleFavorite,
    onRefreshGroups,
    groupsLoading,
    profiles,
    loading,
    selectedIds,
    onToggleProfile,
    onToggleAll,
    sortColumn,
    sortDirection,
    onSort,
}) {
    const favoriteSet = useMemo(
        () => new Set(favoriteGroupIds.map(String)),
        [favoriteGroupIds]
    );
    const orderedGroups = useMemo(
        () => sortGroups(groups, favoriteGroupIds),
        [groups, favoriteGroupIds]
    );
    const sortedProfiles = useMemo(
        () => sortProfiles(profiles, sortColumn, sortDirection),
        [profiles, sortColumn, sortDirection]
    );
    const anySelected = sortedProfiles.some((item) => selectedIds.has(item.profileId));
    const sortMark = (column) => (
        sortColumn === column ? (sortDirection === "asc" ? " ▲" : " ▼") : ""
    );

    return (
        <section className="comment-pane">
            <div className="comment-pane-toolbar">
                <SearchSelect
                    items={orderedGroups}
                    value={groupId}
                    onChange={onGroupIdChange}
                    getId={(item) => item.groupId}
                    getTitle={(item) => (
                        favoriteSet.has(String(item.groupId))
                            ? `★ ${item.groupName}`
                            : item.groupName
                    )}
                    getSubtitle={() => ""}
                    getSearchText={(item) => `${item.groupName} ${item.groupId}`}
                    placeholder="Оберіть групу"
                    searchPlaceholder="Пошук групи…"
                    ariaLabel={`Група ${side}`}
                />
                <button
                    type="button"
                    className={`icon-button ${favoriteSet.has(String(groupId)) ? "active" : ""}`}
                    disabled={!groupId}
                    title="Закріпити групу зверху"
                    onClick={() => onToggleFavorite(groupId)}
                >
                    <Star size={16} fill={favoriteSet.has(String(groupId)) ? "currentColor" : "none"} />
                </button>
                <button
                    type="button"
                    className="icon-button"
                    title="Оновити список груп"
                    disabled={groupsLoading}
                    onClick={onRefreshGroups}
                >
                    <RefreshCw size={16} />
                </button>
            </div>
            <div className="campaign-table-card comment-profile-table">
                <div className="campaign-table-head comment-profile-grid">
                    <label>
                        <input
                            type="checkbox"
                            checked={anySelected}
                            disabled={sortedProfiles.length === 0}
                            onChange={onToggleAll}
                        />
                    </label>
                    <button type="button" className="comment-sort" onClick={() => onSort("profileNo")}>
                        №{sortMark("profileNo")}
                    </button>
                    <button type="button" className="comment-sort" onClick={() => onSort("name")}>
                        Назва{sortMark("name")}
                    </button>
                    <button type="button" className="comment-sort" onClick={() => onSort("tags")}>
                        Теги{sortMark("tags")}
                    </button>
                </div>
                <div className="comment-profile-scroll">
                    {loading && <div className="select-empty">Завантаження профілів…</div>}
                    {!loading && !groupId && (
                        <div className="select-empty">Оберіть групу</div>
                    )}
                    {!loading && groupId && sortedProfiles.length === 0 && (
                        <div className="select-empty">У групі немає профілів</div>
                    )}
                    {!loading && sortedProfiles.map((profile) => {
                        const checked = selectedIds.has(profile.profileId);
                        return (
                            <button
                                type="button"
                                key={profile.profileId}
                                className={`campaign-row comment-profile-grid ${checked ? "selected" : ""}`}
                                onClick={() => onToggleProfile(profile.profileId)}
                            >
                                <span>
                                    <input
                                        type="checkbox"
                                        readOnly
                                        checked={checked}
                                    />
                                </span>
                                <span>{profile.profileNo || "—"}</span>
                                <strong>{profile.name || "Без назви"}</strong>
                                <span className="comment-profile-tags">
                                    {profile.tags?.length
                                        ? profile.tags.map((tag) => (
                                            <span
                                                key={`${tag.id || tag.name}`}
                                                className="comment-tag"
                                                style={tagChipStyle(tag.color)}
                                            >
                                                {tag.name}
                                            </span>
                                        ))
                                        : "—"}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}


export default function CommentAccountsTab({
    groups,
    onGroupsChange,
    favoriteGroupIds,
    onFavoriteGroupIdsChange,
    leftGroupId = "",
    onLeftGroupIdChange = () => {},
    rightGroupId = "",
    onRightGroupIdChange = () => {},
    leftSort = { column: "profileNo", direction: "asc" },
    onLeftSortChange = () => {},
    rightSort = { column: "profileNo", direction: "asc" },
    onRightSortChange = () => {},
    leftSelectedIds = [],
    onLeftSelectedIdsChange = () => {},
    rightSelectedIds = [],
    onRightSelectedIdsChange = () => {},
    onError,
    showToast,
    settings = {},
    lastPhotosDirectory = "",
    onPhotosDirectoryChange = () => {},
}) {
    const [leftProfiles, setLeftProfiles] = useState([]);
    const [rightProfiles, setRightProfiles] = useState([]);
    const [leftLoading, setLeftLoading] = useState(false);
    const [rightLoading, setRightLoading] = useState(false);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [moving, setMoving] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const leftSelected = useMemo(
        () => new Set(leftSelectedIds),
        [leftSelectedIds]
    );
    const rightSelected = useMemo(
        () => new Set(rightSelectedIds),
        [rightSelectedIds]
    );

    const loadProfiles = async (groupId, side) => {
        if (!groupId) {
            if (side === "left") {
                setLeftProfiles([]);
                onLeftSelectedIdsChange([]);
            } else {
                setRightProfiles([]);
                onRightSelectedIdsChange([]);
            }
            return;
        }
        const setLoading = side === "left" ? setLeftLoading : setRightLoading;
        setLoading(true);
        try {
            const profiles = await unwrap(
                window.adsBot.getAdsPowerGroupProfiles(groupId)
            );
            const loadedIds = new Set(profiles.map((item) => item.profileId));
            if (side === "left") {
                setLeftProfiles(profiles);
                onLeftSelectedIdsChange(
                    leftSelectedIds.filter((id) => loadedIds.has(id))
                );
            } else {
                setRightProfiles(profiles);
                onRightSelectedIdsChange(
                    rightSelectedIds.filter((id) => loadedIds.has(id))
                );
            }
        } catch (error) {
            onError?.({ ...errorDetails(error), title: "Не вдалося завантажити профілі" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadProfiles(leftGroupId, "left"); }, [leftGroupId]);
    useEffect(() => { loadProfiles(rightGroupId, "right"); }, [rightGroupId]);

    const refreshGroups = async () => {
        setGroupsLoading(true);
        try {
            const next = await unwrap(window.adsBot.refreshAdsPowerGroups());
            onGroupsChange(next);
            showToast?.("Список груп оновлено", "success");
            if (leftGroupId) await loadProfiles(leftGroupId, "left");
            if (rightGroupId) await loadProfiles(rightGroupId, "right");
        } catch (error) {
            onError?.({ ...errorDetails(error), title: "Не вдалося оновити групи" });
        } finally {
            setGroupsLoading(false);
        }
    };

    const toggleFavorite = (groupId) => {
        if (!groupId) return;
        const id = String(groupId);
        const next = favoriteGroupIds.includes(id)
            ? favoriteGroupIds.filter((item) => item !== id)
            : [...favoriteGroupIds, id];
        onFavoriteGroupIdsChange(next);
    };

    const toggleSort = (side, column) => {
        const current = side === "left" ? leftSort : rightSort;
        const next = {
            column,
            direction: current.column === column && current.direction === "asc"
                ? "desc"
                : "asc",
        };
        if (side === "left") onLeftSortChange(next);
        else onRightSortChange(next);
    };

    const toggleProfile = (side, profileId) => {
        const selected = side === "left" ? leftSelected : rightSelected;
        const next = new Set(selected);
        if (next.has(profileId)) next.delete(profileId);
        else next.add(profileId);
        const ids = [...next];
        if (side === "left") onLeftSelectedIdsChange(ids);
        else onRightSelectedIdsChange(ids);
    };

    const toggleAll = (side) => {
        const profiles = side === "left" ? leftProfiles : rightProfiles;
        const selected = side === "left" ? leftSelected : rightSelected;
        const sorted = sortProfiles(
            profiles,
            side === "left" ? leftSort.column : rightSort.column,
            side === "left" ? leftSort.direction : rightSort.direction
        );
        const ids = sorted.some((item) => selected.has(item.profileId))
            ? []
            : sorted.map((item) => item.profileId);
        if (side === "left") onLeftSelectedIdsChange(ids);
        else onRightSelectedIdsChange(ids);
    };

    const selectedProfiles = useMemo(() => {
        const byId = new Map();
        for (const profile of [...leftProfiles, ...rightProfiles]) {
            if (
                leftSelected.has(profile.profileId)
                || rightSelected.has(profile.profileId)
            ) {
                byId.set(profile.profileId, profile);
            }
        }
        return [...byId.values()];
    }, [leftProfiles, rightProfiles, leftSelected, rightSelected]);

    const refreshPaneProfiles = async () => {
        await Promise.all([
            leftGroupId ? loadProfiles(leftGroupId, "left") : null,
            rightGroupId ? loadProfiles(rightGroupId, "right") : null,
        ]);
        showToast?.("Профілі оновлено", "success");
    };

    const moveSelected = async (from) => {
        const sourceIds = from === "left" ? leftSelected : rightSelected;
        const targetGroupId = from === "left" ? rightGroupId : leftGroupId;
        const sourceGroupId = from === "left" ? leftGroupId : rightGroupId;
        if (!targetGroupId || sourceIds.size === 0) return;
        if (String(targetGroupId) === String(sourceGroupId)) {
            showToast?.("Оберіть різні групи зліва і справа", "info");
            return;
        }
        setMoving(true);
        try {
            const result = await unwrap(
                window.adsBot.moveAdsPowerProfiles([...sourceIds], targetGroupId)
            );
            showToast?.(`Переміщено профілів: ${result.moved}`, "success");
            await Promise.all([
                loadProfiles(leftGroupId, "left"),
                loadProfiles(rightGroupId, "right"),
            ]);
        } catch (error) {
            onError?.({ ...errorDetails(error), title: "Не вдалося перемістити профілі" });
        } finally {
            setMoving(false);
        }
    };

    return (
        <section className="comment-accounts-tab">
            <div className="page-heading split">
                <div>
                    <p className="eyebrow">AdsPower · Total Commander</p>
                    <h2>Акаунти під коментарі</h2>
                </div>
                <button
                    type="button"
                    className="primary-button"
                    disabled={selectedProfiles.length === 0}
                    onClick={() => setCreateOpen(true)}
                >
                    <UserPlus size={16} /> Створити акаунти під коментарі
                </button>
            </div>
            <div className="comment-accounts-workspace">
                <GroupPane
                    side="зліва"
                    groups={groups}
                    favoriteGroupIds={favoriteGroupIds}
                    groupId={leftGroupId}
                    onGroupIdChange={onLeftGroupIdChange}
                    onToggleFavorite={toggleFavorite}
                    onRefreshGroups={refreshGroups}
                    groupsLoading={groupsLoading}
                    profiles={leftProfiles}
                    loading={leftLoading}
                    selectedIds={leftSelected}
                    onToggleProfile={(id) => toggleProfile("left", id)}
                    onToggleAll={() => toggleAll("left")}
                    sortColumn={leftSort.column}
                    sortDirection={leftSort.direction}
                    onSort={(column) => toggleSort("left", column)}
                />
                <div className="comment-pane-transfer">
                    <button
                        type="button"
                        className="icon-button"
                        title="Оновити профілі вибраних груп"
                        disabled={groupsLoading || (!leftGroupId && !rightGroupId)}
                        onClick={refreshPaneProfiles}
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-button"
                        title="Перекинути вибрані вправо"
                        disabled={moving || leftSelected.size === 0 || !rightGroupId}
                        onClick={() => moveSelected("left")}
                    >
                        <ArrowRight size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-button"
                        title="Перекинути вибрані вліво"
                        disabled={moving || rightSelected.size === 0 || !leftGroupId}
                        onClick={() => moveSelected("right")}
                    >
                        <ArrowLeft size={18} />
                    </button>
                </div>
                <GroupPane
                    side="справа"
                    groups={groups}
                    favoriteGroupIds={favoriteGroupIds}
                    groupId={rightGroupId}
                    onGroupIdChange={onRightGroupIdChange}
                    onToggleFavorite={toggleFavorite}
                    onRefreshGroups={refreshGroups}
                    groupsLoading={groupsLoading}
                    profiles={rightProfiles}
                    loading={rightLoading}
                    selectedIds={rightSelected}
                    onToggleProfile={(id) => toggleProfile("right", id)}
                    onToggleAll={() => toggleAll("right")}
                    sortColumn={rightSort.column}
                    sortDirection={rightSort.direction}
                    onSort={(column) => toggleSort("right", column)}
                />
            </div>
            {createOpen && (
                <CreateCommentAccountsModal
                    profiles={selectedProfiles}
                    settings={settings}
                    lastPhotosDirectory={lastPhotosDirectory}
                    onPhotosDirectoryChange={onPhotosDirectoryChange}
                    onClose={() => setCreateOpen(false)}
                    onQueued={() => {
                        setCreateOpen(false);
                        showToast?.("Оформлення акаунтів поставлено в чергу", "success");
                    }}
                    onError={onError}
                />
            )}
        </section>
    );
}
