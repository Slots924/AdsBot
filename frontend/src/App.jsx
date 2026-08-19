import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    BadgeDollarSign,
    LayoutTemplate,
    MessageSquareText,
    Send,
    Settings,
} from "lucide-react";

import LogPanel from "./components/LogPanel.jsx";
import BackgroundTaskPanel from "./components/BackgroundTaskPanel.jsx";
import { Modal, Toast } from "./components/Overlay.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import AdAccountsTab from "./tabs/AdAccountsTab.jsx";
import CommentsTab from "./tabs/CommentsTab.jsx";
import PublishTab from "./tabs/PublishTab.jsx";
import TemplatesTab from "./tabs/TemplatesTab.jsx";
import { errorDetails, unwrap } from "./lib/api.js";
import { findGroupForGeo } from "./lib/groups.js";


const tabs = [
    { id: "publish", label: "Публікація", icon: Send },
    { id: "comments", label: "Коментарі", icon: MessageSquareText },
    { id: "ads", label: "Рекламні акаунти", icon: BadgeDollarSign },
    { id: "templates", label: "Шаблони", icon: LayoutTemplate },
];


export default function App() {
    const [activeTab, setActiveTab] = useState("publish");
    const [accounts, setAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [stateHydrated, setStateHydrated] = useState(false);
    const [uiScale, setUiScale] = useState(1.3);
    const [createCampaignsPaused, setCreateCampaignsPaused] = useState(true);
    const [commentTaskConcurrency, setCommentTaskConcurrency] = useState(2);
    const [taskPanelCollapsed, setTaskPanelCollapsed] = useState(false);
    const [backgroundTasks, setBackgroundTasks] = useState([]);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [selectedAccountKey, setSelectedAccountKey] = useState("");
    const [selectedPageId, setSelectedPageId] = useState("");
    const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
    const [groups, setGroups] = useState([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState([]);
    const [commentsForm, setCommentsForm] = useState({
        geo: "",
        creativeName: "",
        siteUrl: "",
        postUrl: "",
    });
    const [publishForm, setPublishForm] = useState({
        geo: "",
        creativeName: "",
        siteUrl: "",
        imagePath: "",
    });
    const [lastPublishedPost, setLastPublishedPost] = useState(null);
    const [logs, setLogs] = useState([]);
    const [modal, setModal] = useState(null);
    const [toast, setToast] = useState(null);

    const selectedAccount = useMemo(
        () => accounts.find((account) => account.accountKey === selectedAccountKey) ?? null,
        [accounts, selectedAccountKey]
    );

    const applyAccountList = (nextAccounts) => {
        setAccounts(nextAccounts);
        setSelectedAccountKey((current) => (
            nextAccounts.some((account) => (
                account.accountKey === current && !account.archived
            )) ? current : ""
        ));
    };

    const createAccount = async (input) => {
        const nextAccounts = await unwrap(window.adsBot.createAccount(input));
        applyAccountList(nextAccounts);
        showToast("Facebook API-клієнт створено", "success");
    };

    const updateAccount = async (accountKey, patch) => {
        const nextAccounts = await unwrap(window.adsBot.updateAccount(accountKey, patch));
        applyAccountList(nextAccounts);
        showToast(`Акаунт ${accountKey} оновлено`, "success");
    };

    const setAccountArchived = async (accountKey, archived) => {
        const nextAccounts = await unwrap(window.adsBot.setAccountArchived(accountKey, archived));
        applyAccountList(nextAccounts);
        showToast(archived ? `Акаунт ${accountKey} переміщено в архів` : `Акаунт ${accountKey} відновлено`, "success");
    };

    const addLog = (level, scope, message) => {
        setLogs((current) => [...current.slice(-499), {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date().toISOString(),
            level,
            scope,
            message,
        }]);
    };

    const showToast = (message, type = "info") => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3600);
    };

    const refreshBackgroundTasks = async () => {
        const tasks = await unwrap(window.adsBot.getBackgroundTasks());
        setBackgroundTasks(tasks);
        return tasks;
    };

    const loadAccounts = async (refresh = false, preferredAccountKey = null) => {
        setAccountsLoading(true);
        try {
            const nextAccounts = await unwrap(
                refresh
                    ? window.adsBot.refreshAccounts()
                    : window.adsBot.getAccounts()
            );
            setAccounts(nextAccounts);
            setSelectedAccountKey((current) => {
                const candidate = preferredAccountKey ?? current;
                return nextAccounts.some((account) => (
                    account.accountKey === candidate && !account.archived
                ))
                    ? candidate
                    : ""
            });
        } catch (error) {
            setModal({ ...errorDetails(error), title: "Не вдалося завантажити акаунти" });
        } finally {
            setAccountsLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribeLog = window.adsBot.onLog((event) => {
            setLogs((current) => [...current.slice(-499), event]);
        });
        const unsubscribeClose = window.adsBot.onCloseBlocked(({ message }) => {
            showToast(message, "warn");
        });
        const unsubscribeTasks = window.adsBot.onBackgroundTasksUpdated((event) => {
            if (event.type === "snapshot") {
                setBackgroundTasks(event.tasks);
                return;
            }
            if (event.type === "updated" && event.task) {
                setBackgroundTasks((current) => {
                    const exists = current.some((task) => task.id === event.task.id);
                    const next = exists
                        ? current.map((task) => task.id === event.task.id ? event.task : task)
                        : [event.task, ...current];
                    return next.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
                });
            }
        });

        const initialize = async () => {
            let restored = null;
            try {
                restored = await unwrap(window.adsBot.loadAppState());
                setActiveTab(restored.activeTab);
                setUiScale(restored.uiScale);
                setCreateCampaignsPaused(restored.createCampaignsPaused);
                setCommentTaskConcurrency(restored.commentTaskConcurrency);
                setTaskPanelCollapsed(restored.taskPanelCollapsed);
                setSelectedAccountKey(restored.selectedAccountKey);
                setSelectedPageId(restored.selectedPageId);
                setSelectedAdAccountId(restored.selectedAdAccountId);
                setSelectedGroupIds(restored.selectedGroupIds);
                setPublishForm(restored.publishForm);
                setCommentsForm(restored.commentsForm);
                setLastPublishedPost(restored.lastPublishedPost ?? null);
                try {
                    setUiScale(await unwrap(
                        window.adsBot.setUiScale(restored.uiScale)
                    ));
                } catch (error) {
                    addLog("warn", "frontend", `Не вдалося застосувати масштаб: ${error.message}`);
                }
            } catch (error) {
                addLog("warn", "frontend", `Не вдалося відновити стан: ${error.message}`);
            }

            await Promise.all([
                loadAccounts(true, restored?.selectedAccountKey ?? ""),
                unwrap(window.adsBot.getAdsPowerGroups())
                    .then(setGroups)
                    .catch(() => {
                        addLog("warn", "frontend", "Локальний довідник груп поки недоступний");
                    }),
                refreshBackgroundTasks().catch(() => {
                    addLog("warn", "frontend", "Не вдалося завантажити журнал фонових задач");
                }),
            ]);
            setStateHydrated(true);
        };

        initialize();

        return () => {
            unsubscribeLog();
            unsubscribeClose();
            unsubscribeTasks();
        };
    }, []);

    useEffect(() => {
        if (!stateHydrated) return undefined;

        const timeoutId = window.setTimeout(() => {
            unwrap(window.adsBot.saveAppState({
                activeTab,
                uiScale,
                createCampaignsPaused,
                commentTaskConcurrency,
                taskPanelCollapsed,
                selectedAccountKey,
                selectedPageId,
                selectedAdAccountId,
                selectedGroupIds,
                publishForm,
                commentsForm,
                lastPublishedPost,
            })).catch((error) => {
                addLog("warn", "frontend", `Не вдалося зберегти стан: ${error.message}`);
            });
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [
        stateHydrated,
        activeTab,
        uiScale,
        createCampaignsPaused,
        commentTaskConcurrency,
        taskPanelCollapsed,
        selectedAccountKey,
        selectedPageId,
        selectedAdAccountId,
        selectedGroupIds,
        publishForm,
        commentsForm,
        lastPublishedPost,
    ]);

    const changeUiScale = async (nextScale) => {
        const previousScale = uiScale;
        setUiScale(nextScale);
        try {
            setUiScale(await unwrap(window.adsBot.setUiScale(nextScale)));
        } catch (error) {
            setUiScale(previousScale);
            setModal({
                ...errorDetails(error),
                title: "Не вдалося змінити масштаб",
            });
        }
    };

    const changeCommentTaskConcurrency = async (value) => {
        const previous = commentTaskConcurrency;
        const normalized = Math.min(5, Math.max(1, Math.round(Number(value))));
        setCommentTaskConcurrency(normalized);
        try {
            setCommentTaskConcurrency(await unwrap(
                window.adsBot.setCommentTaskConcurrency(normalized)
            ));
        } catch (error) {
            setCommentTaskConcurrency(previous);
            setModal({
                ...errorDetails(error),
                title: "Не вдалося змінити паралельність задач",
            });
        }
    };

    const handlePostSuccess = async ({
        post,
        geo,
        creativeName,
        siteUrl,
        pageId,
        accountKey,
    }) => {
        setLastPublishedPost({
            accountKey,
            pageId: String(pageId ?? ""),
            postId: String(post.postId ?? ""),
        });
        setCommentsForm({
            geo: geo.trim().toUpperCase(),
            creativeName: creativeName.trim(),
            siteUrl: siteUrl.trim(),
            postUrl: post.permalinkUrl || "",
        });

        let availableGroups = groups;
        if (availableGroups.length === 0) {
            try {
                availableGroups = await unwrap(window.adsBot.getAdsPowerGroups());
                setGroups(availableGroups);
            } catch {
                availableGroups = [];
            }
        }

        const match = findGroupForGeo(availableGroups, geo);

        if (match) {
            setSelectedGroupIds((current) =>
                current.includes(match.groupId)
                    ? current
                    : [...current, match.groupId]
            );
            addLog("info", "frontend", `Автоматично вибрано групу ${match.groupName}`);
        }

        showToast("Пост опубліковано. Дані перенесено у вкладку коментарів.", "success");
    };

    return (
        <div className={`app-shell ${taskPanelCollapsed ? "tasks-collapsed" : ""}`}>
            <div className="ambient one" />
            <div className="ambient two" />
            <Sidebar
                accounts={accounts}
                selectedAccountKey={selectedAccountKey}
                loading={accountsLoading}
                onSelect={setSelectedAccountKey}
                onRefresh={() => loadAccounts(true)}
                onCreate={createAccount}
                onUpdate={updateAccount}
                onSetArchived={setAccountArchived}
                onError={setModal}
            />

            <main className="workspace">
                <nav className="tabs">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                                {activeTab === tab.id && <motion.span className="tab-active" layoutId="active-tab" />}
                                <Icon size={16} /><span>{tab.label}</span>
                            </button>
                        );
                    })}
                    <div className="active-profile">
                        <span className={`status-dot ${selectedAccount?.status || "unknown"}`} />
                        {selectedAccount?.accountKey || "Профіль не вибрано"}
                    </div>
                    <button
                        className="icon-button settings-trigger"
                        title="Налаштування"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings size={17} />
                    </button>
                </nav>

                <div className="content-scroll">
                    <AnimatePresence mode="wait">
                        {activeTab === "publish" && (
                            <PublishTab
                                key="publish"
                                selectedAccount={selectedAccount}
                                onError={setModal}
                                onPostSuccess={handlePostSuccess}
                                addLog={addLog}
                                pageId={selectedPageId}
                                setPageId={setSelectedPageId}
                                form={publishForm}
                                setForm={setPublishForm}
                                lastPublishedPost={lastPublishedPost}
                            />
                        )}
                        {activeTab === "comments" && (
                            <CommentsTab
                                key="comments"
                                groups={groups}
                                setGroups={setGroups}
                                selectedGroupIds={selectedGroupIds}
                                setSelectedGroupIds={setSelectedGroupIds}
                                form={commentsForm}
                                setForm={setCommentsForm}
                                onError={setModal}
                                addLog={addLog}
                            />
                        )}
                        {activeTab === "ads" && (
                            <AdAccountsTab
                                key="ads"
                                selectedAccount={selectedAccount}
                                onError={setModal}
                                showToast={showToast}
                                addLog={addLog}
                                selectedId={selectedAdAccountId}
                                setSelectedId={setSelectedAdAccountId}
                                createCampaignsPaused={createCampaignsPaused}
                                lastPublishedPost={lastPublishedPost}
                            />
                        )}
                        {activeTab === "templates" && (
                            <TemplatesTab
                                key="templates"
                                onError={setModal}
                                showToast={showToast}
                            />
                        )}
                    </AnimatePresence>
                </div>

                <LogPanel logs={logs} onClear={() => setLogs([])} />
            </main>

            <BackgroundTaskPanel
                tasks={backgroundTasks}
                collapsed={taskPanelCollapsed}
                onCollapsedChange={setTaskPanelCollapsed}
                onRefresh={refreshBackgroundTasks}
                onError={setModal}
            />

            <Modal modal={modal} onClose={() => setModal(null)} />
            {settingsOpen && (
                <SettingsModal
                    scale={uiScale}
                    onScaleChange={changeUiScale}
                    createCampaignsPaused={createCampaignsPaused}
                    onCreateCampaignsPausedChange={setCreateCampaignsPaused}
                    commentTaskConcurrency={commentTaskConcurrency}
                    onCommentTaskConcurrencyChange={changeCommentTaskConcurrency}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
            <Toast toast={toast} />
        </div>
    );
}
