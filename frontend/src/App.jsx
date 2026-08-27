import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeDollarSign, BarChart3, Bot, BookOpen, MessageSquare, PanelsTopLeft, Settings } from "lucide-react";
import BackgroundTaskPanel from "./components/BackgroundTaskPanel.jsx";
import LogPanel from "./components/LogPanel.jsx";
import { Modal, Toast } from "./components/Overlay.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import AdsWorkspaceTab from "./tabs/AdsWorkspaceTab.jsx";
import AccountsTab from "./tabs/AccountsTab.jsx";
import JournalTab from "./tabs/JournalTab.jsx";
import PagesTab from "./tabs/PagesTab.jsx";
import CommentAccountsTab from "./tabs/CommentAccountsTab.jsx";
import KeitaroTab from "./tabs/KeitaroTab.jsx";
import { errorDetails, unwrap } from "./lib/api.js";

const tabs = [
    { id: "accounts", label: "API-клієнти", icon: Bot },
    { id: "ads", label: "Рекламні кабінети", icon: BadgeDollarSign },
    { id: "pages", label: "Фанпейджі", icon: PanelsTopLeft },
    { id: "comment-accounts", label: "Акаунти під коментарі", icon: MessageSquare },
    { id: "keitaro", label: "Keitaro", icon: BarChart3 },
    { id: "journal", label: "Журнал", icon: BookOpen },
];

export default function App() {
    const [activeTab, setActiveTab] = useState("accounts");
    const [adsSubtab, setAdsSubtab] = useState("accounts");
    const [accounts, setAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [proxies, setProxies] = useState([]);
    const [proxiesLoading, setProxiesLoading] = useState(true);
    const [selectedAccountKey, setSelectedAccountKey] = useState("");
    const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
    const [selectedPageId, setSelectedPageId] = useState("");
    const [workspaceCache, setWorkspaceCache] = useState({});
    const [workspaceLoading, setWorkspaceLoading] = useState(false);
    const [groups, setGroups] = useState([]);
    const [favoriteGroupIds, setFavoriteGroupIds] = useState([]);
    const [commentLeftGroupId, setCommentLeftGroupId] = useState("");
    const [commentRightGroupId, setCommentRightGroupId] = useState("");
    const [commentLeftSort, setCommentLeftSort] = useState({ column: "profileNo", direction: "asc" });
    const [commentRightSort, setCommentRightSort] = useState({ column: "profileNo", direction: "asc" });
    const [commentLeftSelectedIds, setCommentLeftSelectedIds] = useState([]);
    const [commentRightSelectedIds, setCommentRightSelectedIds] = useState([]);
    const [keitaroAvailableGroupIds, setKeitaroAvailableGroupIds] = useState([]);
    const [keitaroSearch, setKeitaroSearch] = useState("");
    const [keitaroGroupId, setKeitaroGroupId] = useState("all");
    const [keitaroDatePreset, setKeitaroDatePreset] = useState("today");
    const [keitaroSort, setKeitaroSort] = useState({ column: "clicks", direction: "desc" });
    const [keitaroColumnOrder, setKeitaroColumnOrder] = useState([
        "id", "name", "group", "state", "clicks", "uniqueClicks", "bots",
        "conversions", "sales", "leads", "rejected", "cr", "cost", "revenue",
        "profit", "roi", "epc", "cpc",
    ]);
    const [keitaroColumnWidths, setKeitaroColumnWidths] = useState({});
    const [keitaroVisibleColumns, setKeitaroVisibleColumns] = useState([
        "id", "name", "clicks", "conversions", "revenue",
    ]);
    const [keitaroPageSize, setKeitaroPageSize] = useState(50);
    const [keitaroConcurrency, setKeitaroConcurrency] = useState(20);
    const [logs, setLogs] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [uiScale, setUiScale] = useState(1.3);
    const [createCampaignsPaused, setCreateCampaignsPaused] = useState(true);
    const [commentWorkerConcurrency, setCommentWorkerConcurrency] = useState(5);
    const [commentWorkerProxyIds, setCommentWorkerProxyIds] = useState({});
    const [commentBrowserMode, setCommentBrowserMode] = useState("visible");
    const [commentDisableImages, setCommentDisableImages] = useState(false);
    const [accountSetupWorkerConcurrency, setAccountSetupWorkerConcurrency] = useState(5);
    const [accountSetupWorkerProxyIds, setAccountSetupWorkerProxyIds] = useState({});
    const [accountSetupBrowserMode, setAccountSetupBrowserMode] = useState("visible");
    const [accountSetupPhotosDirectory, setAccountSetupPhotosDirectory] = useState("");
    const [defaultPixelId, setDefaultPixelId] = useState("");
    const [defaultUtm, setDefaultUtm] = useState("");
    const [logLevel, setLogLevel] = useState("info");
    const [taskPanelCollapsed, setTaskPanelCollapsed] = useState(false);
    const [taskToOpen, setTaskToOpen] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const [modal, setModal] = useState(null);
    const [toast, setToast] = useState(null);

    const selectedAccount = useMemo(() => accounts.find((item) => item.accountKey === selectedAccountKey) || null, [accounts, selectedAccountKey]);
    const workspace = workspaceCache[selectedAccountKey] || { adAccounts: [], pages: [] };
    const settings = { createCampaignsPaused, commentWorkerConcurrency, commentWorkerProxyIds, commentBrowserMode, commentDisableImages, defaultPixelId, defaultUtm };
    const showToast = (message, type = "info") => { setToast({ message, type }); window.setTimeout(() => setToast(null), 3200); };
    const addLog = (level, scope, message) => window.adsBot.writeRendererLog({ level, event: `${scope}.message`, message }).catch(() => {});
    const applyAccounts = (next) => { setAccounts(next); setSelectedAccountKey((current) => next.some((item) => item.accountKey === current && !item.archived) ? current : ""); };

    const loadAccounts = async (refresh = false) => {
        setAccountsLoading(true);
        try { applyAccounts(await unwrap(refresh ? window.adsBot.refreshAccounts() : window.adsBot.getAccounts())); }
        catch (error) { setModal({ ...errorDetails(error), title: "Не вдалося завантажити API-клієнти" }); }
        finally { setAccountsLoading(false); }
    };
    const loadProxies = async () => {
        setProxiesLoading(true);
        try { setProxies(await unwrap(window.adsBot.getProxies())); }
        catch (error) { setModal({ ...errorDetails(error), title: "Не вдалося завантажити проксі" }); }
        finally { setProxiesLoading(false); }
    };
    const loadWorkspace = async (accountKey, force = false) => {
        if (!accountKey || (!force && workspaceCache[accountKey])) return;
        setWorkspaceLoading(true);
        try {
            const value = await unwrap(
                window.adsBot.loadClientWorkspace(accountKey, force)
            );
            setWorkspaceCache((current) => ({ ...current, [accountKey]: value }));
            setSelectedAdAccountId((current) => value.adAccounts.some((item) => item.id === current) ? current : "");
            setSelectedPageId((current) => value.pages.some((item) => item.id === current) ? current : "");
        } catch (error) { setModal({ ...errorDetails(error), title: `Не вдалося завантажити workspace ${accountKey}` }); }
        finally { setWorkspaceLoading(false); }
    };
    const refreshTasks = async () => setTasks(await unwrap(window.adsBot.getBackgroundTasks()));

    useEffect(() => {
        const offLog = window.adsBot.onLog((event) => setLogs((current) => [...current.slice(-499), event]));
        const offTasks = window.adsBot.onBackgroundTasksUpdated((event) => {
            if (event.type === "snapshot") setTasks(event.tasks);
            if (event.type === "updated" && event.task) setTasks((current) => {
                const next = current.some((item) => item.id === event.task.id) ? current.map((item) => item.id === event.task.id ? event.task : item) : [event.task, ...current];
                return next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            });
            if (event.type === "updated" && ["completed", "completed_with_warnings"].includes(event.task?.status)) {
                if (event.task.type === "publication" && event.task.result?.pageId) {
                    const result = event.task.result;
                    setWorkspaceCache((current) => {
                        const cached = current[result.accountKey];
                        if (!cached) return current;
                        return { ...current, [result.accountKey]: { ...cached, pages: cached.pages.map((page) => String(page.id) === String(result.pageId) ? { ...page, geo: result.geo, creativeName: result.creativeName } : page) } };
                    });
                }
                if (event.task.type === "creative-launch" && event.task.metadata?.accountKey) {
                    window.adsBot.loadClientWorkspace(event.task.metadata.accountKey).then(unwrap).then((value) => setWorkspaceCache((current) => ({ ...current, [event.task.metadata.accountKey]: value }))).catch(() => {});
                }
            }
        });
        const offWorkspace = window.adsBot.onWorkspaceRefreshed?.((event) => {
            if (!event?.accountKey || !event?.workspace) return;
            setWorkspaceCache((current) => ({
                ...current,
                [event.accountKey]: event.workspace,
            }));
        }) ?? (() => {});
        const initialize = async () => {
            try {
                const state = await unwrap(window.adsBot.loadAppState());
                setActiveTab(state.activeTab); setAdsSubtab(state.adsSubtab);
                setSelectedAccountKey(state.selectedAccountKey); setSelectedAdAccountId(state.selectedAdAccountId); setSelectedPageId(state.selectedPageId);
                setUiScale(state.uiScale); setCreateCampaignsPaused(state.createCampaignsPaused); setCommentWorkerConcurrency(state.commentWorkerConcurrency);
                setCommentWorkerProxyIds(state.commentWorkerProxyIds || {});
                setCommentBrowserMode(state.commentBrowserMode); setCommentDisableImages(state.commentDisableImages);
                setAccountSetupWorkerConcurrency(state.accountSetupWorkerConcurrency ?? 5);
                setAccountSetupWorkerProxyIds(state.accountSetupWorkerProxyIds || {});
                setAccountSetupBrowserMode(state.accountSetupBrowserMode || "visible");
                setAccountSetupPhotosDirectory(state.accountSetupPhotosDirectory || "");
                setDefaultPixelId(state.defaultPixelId); setDefaultUtm(state.defaultUtm);
                setLogLevel(state.logLevel); setTaskPanelCollapsed(state.taskPanelCollapsed);
                setFavoriteGroupIds(state.favoriteGroupIds || []);
                setCommentLeftGroupId(state.commentLeftGroupId || "");
                setCommentRightGroupId(state.commentRightGroupId || "");
                setCommentLeftSort(state.commentLeftSort || { column: "profileNo", direction: "asc" });
                setCommentRightSort(state.commentRightSort || { column: "profileNo", direction: "asc" });
                setKeitaroAvailableGroupIds(state.keitaroAvailableGroupIds || []);
                setKeitaroSearch(state.keitaroSearch || "");
                setKeitaroGroupId(state.keitaroGroupId || "all");
                setKeitaroDatePreset(state.keitaroDatePreset || "today");
                setKeitaroSort(state.keitaroSort || { column: "clicks", direction: "desc" });
                setKeitaroColumnOrder(state.keitaroColumnOrder || keitaroColumnOrder);
                setKeitaroColumnWidths(state.keitaroColumnWidths || {});
                setKeitaroVisibleColumns(state.keitaroVisibleColumns || [
                    "id", "name", "clicks", "conversions", "revenue",
                ]);
                setKeitaroPageSize(state.keitaroPageSize || 50);
                setKeitaroConcurrency(state.keitaroConcurrency || 20);
                await unwrap(window.adsBot.setUiScale(state.uiScale));
            } catch (error) { addLog("warn", "frontend", error.message); }
            await Promise.all([loadAccounts(true), loadProxies(), unwrap(window.adsBot.getAdsPowerGroups()).then(setGroups).catch(() => {}), refreshTasks().catch(() => {})]);
            setHydrated(true);
        };
        initialize();
        return () => { offLog(); offTasks(); offWorkspace(); };
    }, []);

    useEffect(() => { if (selectedAccount?.status === "active") loadWorkspace(selectedAccountKey); }, [selectedAccountKey, selectedAccount?.status]);
    useEffect(() => {
        if (!hydrated) return undefined;
        const timer = setTimeout(() => window.adsBot.saveAppState({ activeTab, adsSubtab, uiScale, createCampaignsPaused, commentWorkerConcurrency, commentWorkerProxyIds, commentBrowserMode, commentDisableImages, accountSetupWorkerConcurrency, accountSetupWorkerProxyIds, accountSetupBrowserMode, accountSetupPhotosDirectory, defaultPixelId, defaultUtm, logLevel, taskPanelCollapsed, selectedAccountKey, selectedPageId, selectedAdAccountId, favoriteGroupIds, commentLeftGroupId, commentRightGroupId, commentLeftSort, commentRightSort, keitaroAvailableGroupIds, keitaroSearch, keitaroGroupId, keitaroDatePreset, keitaroSort, keitaroColumnOrder, keitaroColumnWidths, keitaroVisibleColumns, keitaroPageSize, keitaroConcurrency }).catch(() => {}), 250);
        return () => clearTimeout(timer);
    }, [hydrated, activeTab, adsSubtab, uiScale, createCampaignsPaused, commentWorkerConcurrency, commentWorkerProxyIds, commentBrowserMode, commentDisableImages, accountSetupWorkerConcurrency, accountSetupWorkerProxyIds, accountSetupBrowserMode, accountSetupPhotosDirectory, defaultPixelId, defaultUtm, logLevel, taskPanelCollapsed, selectedAccountKey, selectedPageId, selectedAdAccountId, favoriteGroupIds, commentLeftGroupId, commentRightGroupId, commentLeftSort, commentRightSort, keitaroAvailableGroupIds, keitaroSearch, keitaroGroupId, keitaroDatePreset, keitaroSort, keitaroColumnOrder, keitaroColumnWidths, keitaroVisibleColumns, keitaroPageSize, keitaroConcurrency]);

    const updateWorkspacePages = (pages) => setWorkspaceCache((current) => ({
        ...current,
        [selectedAccountKey]: {
            ...(current[selectedAccountKey] ?? workspace),
            pages,
        },
    }));
    const refreshFanPageList = async () => {
        if (!selectedAccountKey) return [];
        const pages = await unwrap(window.adsBot.getFanPages(
            selectedAccountKey,
            true
        ));
        updateWorkspacePages(pages);
        return pages;
    };
    const updateWorkspaceAccounts = (adAccounts) => setWorkspaceCache((current) => ({ ...current, [selectedAccountKey]: { ...(current[selectedAccountKey] || workspace), adAccounts } }));
    const createAccount = async (input) => { applyAccounts(await unwrap(window.adsBot.createAccount(input))); showToast("API-клієнта створено", "success"); };
    const updateAccount = async (key, patch) => { applyAccounts(await unwrap(window.adsBot.updateAccount(key, patch))); setWorkspaceCache((current) => { const next = { ...current }; delete next[key]; return next; }); showToast("API-клієнта оновлено", "success"); };
    const archiveAccount = async (key, archived) => applyAccounts(await unwrap(window.adsBot.setAccountArchived(key, archived)));
    const selectAccount = (key) => { setSelectedAccountKey(key); setActiveTab("ads"); loadWorkspace(key); };
    const createProxy = async (input) => { setProxies(await unwrap(window.adsBot.createProxy(input))); showToast("Проксі додано", "success"); };
    const updateProxy = async (proxyId, patch) => { setProxies(await unwrap(window.adsBot.updateProxy(proxyId, patch))); showToast("Проксі оновлено", "success"); };
    const deleteProxy = async (proxyId) => {
        setProxies(await unwrap(window.adsBot.deleteProxy(proxyId)));
        const forgetProxy = (current) => {
            const next = { ...current };
            for (const [workerId, assigned] of Object.entries(next)) {
                if (assigned === proxyId) delete next[workerId];
            }
            return next;
        };
        setCommentWorkerProxyIds(forgetProxy);
        setAccountSetupWorkerProxyIds(forgetProxy);
        showToast("Проксі видалено", "success");
    };
    const reorderProxies = async (orderedIds) => { setProxies(await unwrap(window.adsBot.reorderProxies(orderedIds))); };
    const getProxy = (proxyId) => unwrap(window.adsBot.getProxy(proxyId));
    const checkProxy = (proxyId) => unwrap(window.adsBot.checkProxy(proxyId));
    const checkProxyConfig = (config) => unwrap(window.adsBot.checkProxyConfig(config));
    const refreshProxyIp = (proxyId) => unwrap(window.adsBot.refreshProxyIp(proxyId));

    return <div className={`app-shell navigation-only ${taskPanelCollapsed ? "tasks-collapsed" : ""}`}>
        <main className="workspace full-workspace">
            <nav className="tabs">
                {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{activeTab === tab.id && <motion.span className="tab-active" layoutId="active-tab"/>}<Icon size={16}/><span>{tab.label}</span></button>; })}
                <div className="active-profile"><span className={`status-dot ${selectedAccount?.status || "unknown"}`}/>{selectedAccount?.accountKey || "API-клієнт не вибрано"}{workspaceLoading && <span> · оновлення…</span>}</div>
                <button className="icon-button settings-trigger" onClick={() => setSettingsOpen(true)}><Settings size={17}/></button>
            </nav>
            <div className="content-scroll"><AnimatePresence mode="wait">
                {activeTab === "accounts" && <motion.section key="accounts" className="accounts-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><AccountsTab accounts={accounts} selectedAccountKey={selectedAccountKey} accountsLoading={accountsLoading} onSelectAccount={selectAccount} onRefreshAccounts={() => loadAccounts(true)} onCreateAccount={createAccount} onUpdateAccount={updateAccount} onSetArchived={archiveAccount} proxies={proxies} proxiesLoading={proxiesLoading} onCreateProxy={createProxy} onUpdateProxy={updateProxy} onDeleteProxy={deleteProxy} onGetProxy={getProxy} onCheckProxy={checkProxy} onCheckProxyConfig={checkProxyConfig} onRefreshProxyIp={refreshProxyIp} onReorderProxies={reorderProxies} onError={setModal}/></motion.section>}
                {activeTab === "ads" && <AdsWorkspaceTab key="ads" adsSubtab={adsSubtab} onSubtabChange={setAdsSubtab} selectedAccount={selectedAccount} workspaceAccounts={workspace.adAccounts} onWorkspaceAccountsChange={updateWorkspaceAccounts} onError={setModal} showToast={showToast} addLog={addLog} selectedId={selectedAdAccountId} setSelectedId={setSelectedAdAccountId} createCampaignsPaused={createCampaignsPaused} defaultPixelId={defaultPixelId} defaultUtm={defaultUtm}/>}
                {activeTab === "pages" && (
                    <PagesTab
                        key="pages"
                        selectedAccount={selectedAccount}
                        pages={workspace.pages}
                        adAccounts={workspace.adAccounts}
                        groups={groups}
                        selectedPageId={selectedPageId}
                        setSelectedPageId={setSelectedPageId}
                        onPagesChange={updateWorkspacePages}
                        onRefresh={refreshFanPageList}
                        settings={settings}
                        onError={setModal}
                        showToast={showToast}
                    />
                )}
                {activeTab === "comment-accounts" && (
                    <CommentAccountsTab
                        key="comment-accounts"
                        groups={groups}
                        onGroupsChange={setGroups}
                        favoriteGroupIds={favoriteGroupIds}
                        onFavoriteGroupIdsChange={setFavoriteGroupIds}
                        leftGroupId={commentLeftGroupId}
                        onLeftGroupIdChange={setCommentLeftGroupId}
                        rightGroupId={commentRightGroupId}
                        onRightGroupIdChange={setCommentRightGroupId}
                        leftSort={commentLeftSort}
                        onLeftSortChange={setCommentLeftSort}
                        rightSort={commentRightSort}
                        onRightSortChange={setCommentRightSort}
                        leftSelectedIds={commentLeftSelectedIds}
                        onLeftSelectedIdsChange={setCommentLeftSelectedIds}
                        rightSelectedIds={commentRightSelectedIds}
                        onRightSelectedIdsChange={setCommentRightSelectedIds}
                        onError={setModal}
                        showToast={showToast}
                        lastPhotosDirectory={accountSetupPhotosDirectory}
                        onPhotosDirectoryChange={setAccountSetupPhotosDirectory}
                        settings={{
                            accountSetupWorkerConcurrency,
                            accountSetupWorkerProxyIds,
                            accountSetupBrowserMode,
                        }}
                    />
                )}
                {activeTab === "keitaro" && (
                    <KeitaroTab
                        key="keitaro"
                        availableGroupIds={keitaroAvailableGroupIds}
                        search={keitaroSearch}
                        onSearchChange={setKeitaroSearch}
                        selectedGroupId={keitaroGroupId}
                        onSelectedGroupIdChange={setKeitaroGroupId}
                        datePreset={keitaroDatePreset}
                        onDatePresetChange={setKeitaroDatePreset}
                        sort={keitaroSort}
                        onSortChange={setKeitaroSort}
                        columnOrder={keitaroColumnOrder}
                        onColumnOrderChange={setKeitaroColumnOrder}
                        columnWidths={keitaroColumnWidths}
                        onColumnWidthsChange={setKeitaroColumnWidths}
                        visibleColumns={keitaroVisibleColumns}
                        onVisibleColumnsChange={setKeitaroVisibleColumns}
                        pageSize={keitaroPageSize}
                        onPageSizeChange={setKeitaroPageSize}
                        onError={setModal}
                    />
                )}
                {activeTab === "journal" && <JournalTab key="journal" onError={setModal} showToast={showToast} onOpenTask={(id) => { setTaskPanelCollapsed(false); setTaskToOpen(id); }}/>}
            </AnimatePresence></div>
            <LogPanel logs={logs} onClear={() => setLogs([])}/>
        </main>
        <BackgroundTaskPanel tasks={tasks} collapsed={taskPanelCollapsed} onCollapsedChange={setTaskPanelCollapsed} onRefresh={refreshTasks} onError={setModal} openTaskId={taskToOpen} onOpenTaskHandled={() => setTaskToOpen(null)} proxies={proxies} proxiesLoading={proxiesLoading} commentWorkerProxyIds={commentWorkerProxyIds} onCommentWorkerProxyIdsChange={setCommentWorkerProxyIds} onCreateProxy={createProxy} onUpdateProxy={updateProxy} onDeleteProxy={deleteProxy} onGetProxy={getProxy} onCheckProxy={checkProxy} onCheckProxyConfig={checkProxyConfig} onRefreshProxyIp={refreshProxyIp}/>
        <Modal modal={modal} onClose={() => setModal(null)}/>
        {settingsOpen && <SettingsModal scale={uiScale} onScaleChange={async (value) => setUiScale(await unwrap(window.adsBot.setUiScale(value)))} createCampaignsPaused={createCampaignsPaused} onCreateCampaignsPausedChange={setCreateCampaignsPaused} commentWorkerConcurrency={commentWorkerConcurrency} onCommentWorkerConcurrencyChange={setCommentWorkerConcurrency} commentWorkerProxyIds={commentWorkerProxyIds} onCommentWorkerProxyIdsChange={setCommentWorkerProxyIds} defaultPixelId={defaultPixelId} onDefaultPixelIdChange={setDefaultPixelId} defaultUtm={defaultUtm} onDefaultUtmChange={setDefaultUtm} commentBrowserMode={commentBrowserMode} onCommentBrowserModeChange={setCommentBrowserMode} commentDisableImages={commentDisableImages} onCommentDisableImagesChange={setCommentDisableImages} accountSetupWorkerConcurrency={accountSetupWorkerConcurrency} onAccountSetupWorkerConcurrencyChange={setAccountSetupWorkerConcurrency} accountSetupWorkerProxyIds={accountSetupWorkerProxyIds} onAccountSetupWorkerProxyIdsChange={setAccountSetupWorkerProxyIds} accountSetupBrowserMode={accountSetupBrowserMode} onAccountSetupBrowserModeChange={setAccountSetupBrowserMode} logLevel={logLevel} onLogLevelChange={async (value) => setLogLevel(await unwrap(window.adsBot.setLogLevel(value)))} proxies={proxies} proxiesLoading={proxiesLoading} onCreateProxy={createProxy} onUpdateProxy={updateProxy} onDeleteProxy={deleteProxy} onGetProxy={getProxy} onCheckProxy={checkProxy} onCheckProxyConfig={checkProxyConfig} onRefreshProxyIp={refreshProxyIp} keitaroAvailableGroupIds={keitaroAvailableGroupIds} onKeitaroAvailableGroupIdsChange={setKeitaroAvailableGroupIds} keitaroConcurrency={keitaroConcurrency} onKeitaroConcurrencyChange={setKeitaroConcurrency} onError={setModal} onClose={() => setSettingsOpen(false)}/>}<Toast toast={toast}/>
    </div>;
}
