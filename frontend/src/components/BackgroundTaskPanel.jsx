import { useEffect, useMemo, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleStop,
    Clock3,
    Flashlight,
    ListChecks,
    LoaderCircle,
    RotateCcw,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import WorkerProxyPicker from "./WorkerProxyPicker.jsx";


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


function taskProxyAlerts(task) {
    return Array.isArray(task?.progress?.workerProxyAlerts)
        ? task.progress.workerProxyAlerts
        : [];
}


export default function BackgroundTaskPanel({
    tasks,
    collapsed,
    onCollapsedChange,
    onRefresh,
    onError,
    openTaskId = null,
    onOpenTaskHandled = () => {},
    proxies = [],
    proxiesLoading = false,
    commentWorkerProxyIds = {},
    onCommentWorkerProxyIdsChange = () => {},
    onCreateProxy,
    onUpdateProxy,
    onDeleteProxy,
    onGetProxy,
    onCheckProxy,
    onCheckProxyConfig,
    onRefreshProxyIp,
}) {
    const [selected, setSelected] = useState(null);
    const [campaignJob, setCampaignJob] = useState(null);
    const [creativeJob, setCreativeJob] = useState(null);
    const [actionPending, setActionPending] = useState(false);
    const [proxyPicker, setProxyPicker] = useState(null);
    const activeCount = useMemo(
        () => tasks.filter((task) => activeStatuses.has(task.status)).length,
        [tasks]
    );
    const attentionCount = useMemo(
        () => tasks.filter((task) => activeStatuses.has(task.status)
            || ["failed", "interrupted", "completed_with_warnings"].includes(task.status)).length,
        [tasks]
    );
    const proxyAlertTasks = useMemo(
        () => tasks.filter((task) => taskProxyAlerts(task).length > 0),
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
        setCreativeJob(null);
        if (task.metadata?.workflowJobId) {
            try { setCreativeJob(await unwrap(window.adsBot.getCreativeLaunch(task.metadata.workflowJobId))); }
            catch (error) { onError({ ...errorDetails(error), title: "Не вдалося завантажити деталі запуску" }); }
        }
        const jobId = task.metadata?.campaignJobId;
        if (!jobId) return;
        try {
            setCampaignJob(await unwrap(window.adsBot.getCampaignCreationJob(jobId)));
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити деталі кампанії" });
        }
    };

    useEffect(() => {
        if (!openTaskId) return;
        const task = tasks.find((item) => item.id === openTaskId);
        if (task) openTask(task);
        onOpenTaskHandled();
    }, [openTaskId, tasks]);

    const resolveProxyAlert = async (task, alert, payload) => {
        await action(() => unwrap(window.adsBot.resolveBackgroundTaskAction(
            task.id,
            `comment-proxy:${alert.workerId}`,
            payload
        )));
        if (payload.type === "replace" && payload.proxyId) {
            onCommentWorkerProxyIdsChange({
                ...commentWorkerProxyIds,
                [String(alert.workerId)]: payload.proxyId,
            });
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
                    {collapsed && proxyAlertTasks.length > 0 && (
                        <span className="task-proxy-flashlight" title="Проксі воркера не працює">
                            <Flashlight size={16} />
                        </span>
                    )}
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
                                        <div className="task-card-heading">
                                            <TaskIcon status={task.status} />
                                            <strong>{task.name}</strong>
                                            {taskProxyAlerts(task).length > 0 && (
                                                <span className="task-proxy-flashlight" title="Проксі воркера не працює">
                                                    <Flashlight size={15} />
                                                </span>
                                            )}
                                        </div>
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
                                        {Array.isArray(task.progress?.subtasks) && <div className="task-subtasks-mini">{task.progress.subtasks.map((subtask) => <span key={subtask.id} className={subtask.status}>{subtask.title}: {statusLabels[subtask.status] || subtask.status}</span>)}</div>}
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
                            {selected.metadata?.reportId && <div className="wide"><span>Report ID</span><strong>{selected.metadata.reportId}</strong></div>}
                            {(selected.progress?.objects?.campaignId || campaignJob?.objects?.campaignId) && <div className="wide"><span>Campaign ID</span><strong>{selected.progress?.objects?.campaignId || campaignJob.objects.campaignId}</strong></div>}
                        </div>
                        {selected.error && <div className="creation-error"><AlertCircle size={18} /><div><strong>{selected.error.message}</strong><span>{selected.error.code || "TASK_ERROR"}</span></div></div>}
                        {taskProxyAlerts(selected).map((alert) => (
                            <div className="task-proxy-alert" key={`${alert.workerId}-${alert.commentId}`}>
                                <Flashlight size={16} />
                                <div>
                                    <strong>{alert.message}</strong>
                                    <span>Можна пропустити цей коментар або замінити проксі воркера.</span>
                                </div>
                                <div className="task-proxy-alert-actions">
                                    <button
                                        className="secondary-button"
                                        disabled={actionPending}
                                        onClick={() => resolveProxyAlert(selected, alert, { type: "skip" })}
                                    >
                                        Пропустити коментар
                                    </button>
                                    <button
                                        className="primary-button"
                                        disabled={actionPending}
                                        onClick={() => setProxyPicker({ task: selected, alert })}
                                    >
                                        Замінити проксі
                                    </button>
                                </div>
                            </div>
                        ))}
                        {Array.isArray(selected.progress?.subtasks) && <div className="task-subtask-details">{selected.progress.subtasks.map((subtask) => <article key={subtask.id} className={subtask.status}><div><TaskIcon status={subtask.status}/><strong>{subtask.title}</strong></div><span>{statusLabels[subtask.status] || subtask.status}</span><small>{subtask.message || subtask.error?.message || "—"}</small></article>)}</div>}
                        <div className="form-actions">
                            {activeStatuses.has(selected.status) && <button className="secondary-button danger" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.cancelBackgroundTask(selected.id)))}><CircleStop size={15} /> Зупинити</button>}
                            {selectedRetryable && selected.metadata?.campaignJobId && <button className="secondary-button" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.retryCampaignCreation(selected.metadata.campaignJobId)))}><RotateCcw size={15} /> Повторити</button>}
                            {selectedRetryable && selected.metadata?.workflowJobId && !creativeJob?.post?.postId && <button className="secondary-button" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.retryCreativeLaunch(selected.metadata.workflowJobId)))}><RotateCcw size={15} /> Нова пов’язана спроба</button>}
                            {creativeJob?.campaignJobId && creativeJob.subtasks?.find((item) => item.id === "campaign")?.status === "failed" && <button className="secondary-button" disabled={actionPending} onClick={() => action(() => unwrap(window.adsBot.retryCampaignCreation(creativeJob.campaignJobId)))}><RotateCcw size={15} /> Повторити лише кампанію</button>}
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
            {proxyPicker && (
                <WorkerProxyPicker
                    workerId={proxyPicker.alert.workerId}
                    proxies={proxies}
                    proxiesLoading={proxiesLoading}
                    excludedIds={Object.entries(commentWorkerProxyIds)
                        .filter(([workerId]) => Number(workerId) !== Number(proxyPicker.alert.workerId))
                        .map(([, proxyId]) => proxyId)}
                    onCreate={onCreateProxy}
                    onUpdate={onUpdateProxy}
                    onDelete={onDeleteProxy}
                    onGet={onGetProxy}
                    onCheck={onCheckProxy}
                    onCheckConfig={onCheckProxyConfig}
                    onRefreshIp={onRefreshProxyIp}
                    onError={onError}
                    onConfirm={async (proxyId) => {
                        const { task, alert } = proxyPicker;
                        setProxyPicker(null);
                        await resolveProxyAlert(task, alert, { type: "replace", proxyId });
                    }}
                    onClose={() => setProxyPicker(null)}
                />
            )}
        </>
    );
}
