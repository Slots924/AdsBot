import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
    Download,
    FileText,
    LoaderCircle,
    RefreshCw,
    Search,
    Terminal,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const statusLabels = {
    completed: "Готово",
    completed_with_warnings: "З попередженнями",
    failed: "Помилка",
    interrupted: "Перервано",
    cancelled: "Скасовано",
};


export default function JournalTab({ onError, showToast, onOpenTask = () => {} }) {
    const [mode, setMode] = useState("events");
    const [logs, setLogs] = useState([]);
    const [reports, setReports] = useState([]);
    const [scopes, setScopes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [nextCursor, setNextCursor] = useState(null);
    const [query, setQuery] = useState("");
    const [level, setLevel] = useState("");
    const [scope, setScope] = useState("");
    const [taskId, setTaskId] = useState("");
    const [logTaskType, setLogTaskType] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [reportType, setReportType] = useState("");
    const [reportStatus, setReportStatus] = useState("");
    const [selectedLog, setSelectedLog] = useState(null);
    const [selectedReport, setSelectedReport] = useState(null);

    const fail = (error, title) => onError({ ...errorDetails(error), title });

    const loadLogs = async ({ append = false } = {}) => {
        setLoading(true);
        try {
            const response = await unwrap(window.adsBot.getLogs({
                cursor: append ? nextCursor : null,
                limit: 100,
                levels: level ? [level] : [],
                scopes: scope ? [scope] : [],
                query,
                taskId: taskId.trim() || undefined,
                taskType: logTaskType || undefined,
                dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
                dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
            }));
            setLogs((current) => append ? [...current, ...response.items] : response.items);
            setNextCursor(response.nextCursor);
        } catch (error) {
            fail(error, "Не вдалося завантажити журнал");
        } finally {
            setLoading(false);
        }
    };

    const loadReports = async () => {
        setLoading(true);
        try {
            setReports(await unwrap(window.adsBot.getReports({
                query,
                type: reportType || undefined,
                status: reportStatus || undefined,
                dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
                dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
            })));
        } catch (error) {
            fail(error, "Не вдалося завантажити звіти");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        unwrap(window.adsBot.getLogScopes()).then(setScopes).catch(() => {});
    }, []);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            if (mode === "events") loadLogs();
            else loadReports();
        }, 200);
        return () => window.clearTimeout(timeout);
    }, [mode, query, level, scope, taskId, logTaskType, reportType, reportStatus, dateFrom, dateTo]);

    const openReport = async (report) => {
        try {
            setSelectedReport(await unwrap(window.adsBot.getReport(report.id)));
        } catch (error) {
            fail(error, "Не вдалося відкрити звіт");
        }
    };

    const deleteReport = async () => {
        if (!selectedReport || !window.confirm("Видалити цей звіт без можливості відновлення?")) return;
        try {
            await unwrap(window.adsBot.deleteReport(selectedReport.id));
            setSelectedReport(null);
            await loadReports();
            showToast("Звіт видалено", "success");
        } catch (error) {
            fail(error, "Не вдалося видалити звіт");
        }
    };

    const exportReport = async () => {
        try {
            const file = await unwrap(window.adsBot.exportReportMarkdown(selectedReport.id));
            if (file) showToast("Markdown-звіт експортовано", "success");
        } catch (error) {
            fail(error, "Не вдалося експортувати звіт");
        }
    };

    return (
        <motion.section className="tab-content journal-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="page-heading split">
                <div><span className="eyebrow">Diagnostics & reports</span><h1>Журнал</h1><p>Технічні події та підсумки фонових задач.</p></div>
                <button className="secondary-button" disabled={loading} onClick={() => mode === "events" ? loadLogs() : loadReports()}><RefreshCw className={loading ? "spin" : ""} size={16} /> Оновити</button>
            </div>

            <div className="journal-mode-switch">
                <button className={mode === "events" ? "active" : ""} onClick={() => setMode("events")}><Terminal size={15} /> Події</button>
                <button className={mode === "reports" ? "active" : ""} onClick={() => setMode("reports")}><FileText size={15} /> Звіти</button>
            </div>

            <div className="journal-filters">
                <label className="field journal-search"><span>Пошук</span><div><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Повідомлення, ID або назва…" /></div></label>
                {mode === "events" && <>
                    <label className="field"><span>Рівень</span><select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">Усі</option><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select></label>
                    <label className="field"><span>Scope</span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="">Усі</option>{scopes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                    <label className="field"><span>Task ID</span><input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="UUID задачі" /></label>
                    <label className="field"><span>Тип задачі</span><select value={logTaskType} onChange={(event) => setLogTaskType(event.target.value)}><option value="">Усі</option><option value="publication">Публікація</option><option value="comments">Коментарі</option><option value="campaign">Кампанія</option><option value="campaign-cleanup">Cleanup</option></select></label>
                </>}
                {mode === "reports" && <>
                    <label className="field"><span>Тип</span><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="">Усі</option><option value="publication">Публікація</option><option value="comments">Коментарі</option><option value="campaign">Кампанія</option><option value="campaign-cleanup">Cleanup</option></select></label>
                    <label className="field"><span>Статус</span><select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)}><option value="">Усі</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </>}
                <label className="field"><span>Від</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
                <label className="field"><span>До</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            </div>

            {loading && !(mode === "events" ? logs.length : reports.length) && <div className="journal-empty"><LoaderCircle className="spin" /> Завантажуємо…</div>}
            {mode === "events" && <div className="journal-table">
                {logs.map((entry) => <button className={`journal-row ${entry.level}`} key={entry.id} onClick={() => setSelectedLog(entry)}><time>{new Date(entry.timestamp).toLocaleString("uk-UA")}</time><b>{entry.level}</b><span>{entry.scope}</span><strong>{entry.message}</strong></button>)}
                {!loading && !logs.length && <div className="journal-empty">Подій за цими фільтрами немає.</div>}
                {nextCursor && <button className="secondary-button journal-more" disabled={loading} onClick={() => loadLogs({ append: true })}>Завантажити ще</button>}
            </div>}
            {mode === "reports" && <div className="journal-table">
                {reports.map((report) => <button className={`journal-row report ${report.status}`} key={report.id} onClick={() => openReport(report)}><time>{new Date(report.createdAt).toLocaleString("uk-UA")}</time><b>{statusLabels[report.status] || report.status}</b><span>{report.type}</span><strong>{report.title}</strong></button>)}
                {!loading && !reports.length && <div className="journal-empty">Звітів за цими фільтрами немає.</div>}
            </div>}

            {(selectedLog || selectedReport) && <div className="overlay" onMouseDown={() => { setSelectedLog(null); setSelectedReport(null); }}><div className="modal journal-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
                <button className="modal-close" onClick={() => { setSelectedLog(null); setSelectedReport(null); }}><X size={17} /></button>
                <span className="eyebrow">{selectedReport ? "Task report" : selectedLog.scope}</span>
                <h2>{selectedReport?.title || selectedLog.message}</h2>
                <pre>{JSON.stringify(selectedReport || selectedLog, null, 2)}</pre>
                <div className="form-actions">
                    {selectedReport?.taskId && <button className="secondary-button" onClick={() => onOpenTask(selectedReport.taskId)}>Відкрити задачу</button>}
                    {selectedReport && <button className="secondary-button danger" onClick={deleteReport}><Trash2 size={15} /> Видалити</button>}
                    {selectedReport && <button className="secondary-button" onClick={exportReport}><Download size={15} /> Markdown</button>}
                    <span className="action-spacer" /><button className="primary-button" onClick={() => { setSelectedLog(null); setSelectedReport(null); }}>Закрити</button>
                </div>
            </div></div>}
        </motion.section>
    );
}
