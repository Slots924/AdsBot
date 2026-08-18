import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeDollarSign, MessageSquareText, Send } from "lucide-react";

import LogPanel from "./components/LogPanel.jsx";
import { Modal, Toast } from "./components/Overlay.jsx";
import Sidebar from "./components/Sidebar.jsx";
import AdAccountsTab from "./tabs/AdAccountsTab.jsx";
import CommentsTab from "./tabs/CommentsTab.jsx";
import PublishTab from "./tabs/PublishTab.jsx";
import { errorDetails, unwrap } from "./lib/api.js";
import { findGroupForGeo } from "./lib/groups.js";


const tabs = [
    { id: "publish", label: "Публікація", icon: Send },
    { id: "comments", label: "Коментарі", icon: MessageSquareText },
    { id: "ads", label: "Рекламні акаунти", icon: BadgeDollarSign },
];


export default function App() {
    const [activeTab, setActiveTab] = useState("publish");
    const [accounts, setAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [selectedAccountKey, setSelectedAccountKey] = useState("");
    const [groups, setGroups] = useState([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState([]);
    const [commentsForm, setCommentsForm] = useState({
        geo: "",
        creativeName: "",
        siteUrl: "",
        postUrl: "",
    });
    const [logs, setLogs] = useState([]);
    const [modal, setModal] = useState(null);
    const [toast, setToast] = useState(null);

    const selectedAccount = useMemo(
        () => accounts.find((account) => account.accountKey === selectedAccountKey) ?? null,
        [accounts, selectedAccountKey]
    );

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

    const loadAccounts = async (refresh = false) => {
        setAccountsLoading(true);
        try {
            const nextAccounts = await unwrap(
                refresh
                    ? window.adsBot.refreshAccounts()
                    : window.adsBot.getAccounts()
            );
            setAccounts(nextAccounts);
            setSelectedAccountKey((current) =>
                nextAccounts.some((account) => account.accountKey === current)
                    ? current
                    : ""
            );
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

        loadAccounts();
        unwrap(window.adsBot.getAdsPowerGroups())
            .then(setGroups)
            .catch(() => {
                addLog("warn", "frontend", "Локальний довідник груп поки недоступний");
            });

        return () => {
            unsubscribeLog();
            unsubscribeClose();
        };
    }, []);

    const handlePostSuccess = async ({
        post,
        geo,
        creativeName,
        siteUrl,
    }) => {
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
        <div className="app-shell">
            <div className="ambient one" />
            <div className="ambient two" />
            <Sidebar
                accounts={accounts}
                selectedAccountKey={selectedAccountKey}
                loading={accountsLoading}
                onSelect={setSelectedAccountKey}
                onRefresh={() => loadAccounts(true)}
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
                            <AdAccountsTab key="ads" selectedAccount={selectedAccount} onError={setModal} />
                        )}
                    </AnimatePresence>
                </div>

                <LogPanel logs={logs} onClear={() => setLogs([])} />
            </main>

            <Modal modal={modal} onClose={() => setModal(null)} />
            <Toast toast={toast} />
        </div>
    );
}
