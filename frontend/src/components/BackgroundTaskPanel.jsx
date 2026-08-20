import { useEffect, useMemo, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleStop,
    Clock3,
    ListChecks,
    LoaderCircle,
    RotateCcw,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const activeStatuses = new Set(["queued", "running"]);
const statusLabels = {
    queued: "У черзі",
    running: "Виконується",
    completed: "Готово",
    completed_with_warnings: "Готово з попередженнями",
    failed: "Помилка",
    interrupted: "Перервано",
    cancelled: "Скасовано",
};


function TaskIcon({ status }) {
    if (status === "running") return <LoaderCircle className="spin" size={15} />;
    if (status === "queued") return <Clock3 size={15} />;
    if (status === "completed") return <CheckCircle2 size={15} />;
    return <AlertCircle size={15} />;
}


function taskPercent(task) {
    const total = Number(task.progress?.total);
    const completed = Number(task.progress?.completed);
    if (["completed", "completed_with_warnings"].includes(task.status)) return 100;
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(completed / total * 100)));
}


export default function BackgroundTaskPanel({
    tasks,
    collapsed,
    onCollapsedChange,
    onRefresh,
    onError,
}) {
    const [selected, setSelected] = useState(null);
    const [campaignJob, setCampaignJob] = useState(null);
    const [actionPending, setActionPending] = useState(false);
    const activeCount = useMemo(
        () => tasks.filter((task) => activeStatuses.has(task.status)).length,
        [tasks]
    );
    const attentionCount = useMemo(
        () => tasks.filter((task) => activeStatuses.has(task.status)
            || ["failed", "interrupted", "completed_with_warnings"].includes(task.status)).length,
        [tasks]
    );
    const selectedRetryable = selected
        && ["failed", "interrupted"].includes(selected.status);

    useEffect(() => {
        if (!selected) return;
        const updated = tasks.find((task) => task.id === selected.id);
        if (updated) setSelected(updated);
        else setSelected(null);
    }, [tasks]);

    const openTask = async (task) => {
        setSelected(task);
        setCampaignJob(null);
        const jobId = task.metadata?.campaignJobId;
        if (!jobId) return;
        try {
            setCampaignJob(await unwrap(window.adsBot.getCampaignCreationJob(jobId)));
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити деталі кампанії" });
        }
    };

    const action = async (operation) => {
        setActionPending(true);
        try {
            await operation();
            await onRefresh();
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося виконати дію із задачею" });
        } finally {
            setActionPending(false);
        }
    };

    return (
        <>
            <aside className={`task-panel ${collapsed ? "collapsed" : ""}`}>
                <header>
                    <button className="icon-button" onClick={() => onCollapsedChange(!collapsed)} title={collapsed ? "Відкрити задачі" : "Згорнути задачі"}>
                        {collapsed ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
                    </button>
                    {!collapsed && <><div><span className="eyebrow">Background</span><strong>Задачі</strong></div><b>{activeCount || tasks.length}</b></>}
                    {collapsed && attentionCount > 0 && <b className="task-rail-count">{attentionCount}</b>}
                </header>

                {!collapsed && (
                    <div className="task-panel-body">
                        <div className="task-panel-tools">
                            <span>{tasks.length} у журналі</span>
                            <button disabled={!tasks.some((task) => !activeStatuses.has(task.status))} onClick={() => action(() => unwrap(window.adsBot.clearFinishedBackgroundTasks()))}>Очистити завершені</button>
                        </div>
                        <div className="task-list">
                            {tasks.map((task) => {
                                const percent = taskPercent(task);
                                return (
                                    <article key={task.id} className={`task-card ${task.status}`} onClick={() => openTask(task)}>
                                        <div className="task-card-heading"><TaskIcon status={task.status} /><strong>{task.name}</strong></div>
                                        <span>{statusLabels[task.status] || task.status}</span>
                                        <div className="task-card-progress"><i style={{ width: `${percent}%` }} /></div>
                                        <small>{task.waitingReason || task.progress?.message || task.error?.message || "—"}</small>
                                        {task.type === "comments" && task.progress && (
                                            <div className="task-counters">
                                                <span>✓ {task.progress.published || 0}</span>
                                                <span>↷ {task.progress.skipped || 0}</span>
                                                <span>! {task.progress.failedComments || 0}</span>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                            {!tasks.length && <div className="task-list-empty"><ListChecks size={25} /><span>Фонових задач поки немає</span></div>}
                        </div>
                    </div>
                )}
            </aside>

            {selected && (
                <div className="overlay" onMouseDown={() => setSelected(null)}>
                    <div className="modal task-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
                        <button className="modal-close" onClick={() => setSelected(null)}><X size={17} /></button>
                        <div className="modal-icon task-detail-icon"><TaskIcon status={selected.status} /></div>
                        <span className="eyebrow">{selected.type}</span>
                        <h2>{selected.name}</h2>
                        <p>{statusLabels[selected.status] || selected.status} · {selected.progress?.message || selected.waitingReason || "Без додаткових деталей"}</p>
                        <div className="task-detail-grid">
                            <div><span>Створено</span><strong>{new Date(selected.createdAt).toLocaleString("uk-UA")}</strong></div>
                            <div><span>Етап</span><strong>{selected.progress?.stage || "—"}</strong></div>
                            {selected.type === "comments" && <div><span>Режим браузера</span><strong>{selected.metadata?.browserMode === "headless" ? "Headless" : "Звичайний"}</strong></div>}
                            {selected.type === "comments" && <div><span>Зображення</span><strong>{selected.metadata?.disableImages ? "Вимкнені" : "Завантажуються"}</strong></div>}
                            {selected.result?.reportPath && <div className="wide"><span>Звіт</span><strong>{selected.result.reportPath}</strong></div>}
                            {(selected.progress?.objects?.campaignId || campaignJob?.objects?.campaignId) && <div className="wide"><span>Campaign ID</span><strong>{selected.progress?.objects?.campaignId || campaignJob.objects.campaignId}</strong></div>}
                        </div>
                        {selected.error && <div className="creation-error"><AlertCircle size={18} /><div><strong>{selected.error.message}</strong><span>{selected.error.code || "TASK_ERROR"}</span></div></div>}
                        <div className="form-actions">
                            {activeStatuses.has(selected.status) && <button className="secondary-button danger" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.cancelBackgroundTask(selected.id)))}><CircleStop size={15} /> Зупинити</button>}
                            {selectedRetryable && selected.metadata?.campaignJobId && <button className="secondary-button" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.retryCampaignCreation(selected.metadata.campaignJobId)))}><RotateCcw size={15} /> Повторити</button>}
                            {selectedRetryable && campaignJob?.objects?.campaignId && <button className="secondary-button danger" disabled={actionPending} onClick={() => {
                                if (window.confirm("Видалити всі відомі Meta-об’єкти цієї спроби?")) {
                                    action(() => unwrap(window.adsBot.cleanupCampaignCreation(selected.metadata.campaignJobId)));
                                }
                            }}><Trash2 size={15} /> Очистити чернетку</button>}
                            {!activeStatuses.has(selected.status) && <button className="secondary-button danger" disabled={actionPending} onClick={() => action(async () => { await unwrap(window.adsBot.dismissBackgroundTask(selected.id)); setSelected(null); })}><Trash2 size={15} /> Прибрати</button>}
                            <span className="action-spacer" />
                            <button className="primary-button" onClick={() => setSelected(null)}>Закрити</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
