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

const workflowReportLabels = {
    comments: "Коментарі",
    "account-setup": "Оформлення акаунтів",
};


function MarkdownPreview({ content }) {
    const lines = String(content ?? "").split("\n");
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index += 1; continue; }
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            const Tag = `h${heading[1].length}`;
            blocks.push(<Tag key={`heading-${index}`}>{heading[2]}</Tag>);
            index += 1;
            continue;
        }
        if (line.startsWith("|")) {
            const tableLines = [];
            while (lines[index]?.startsWith("|")) tableLines.push(lines[index++]);
            const rows = tableLines.filter((item, rowIndex) => rowIndex !== 1)
                .map((item) => item.split("|").slice(1, -1).map((cell) => cell.trim()));
            blocks.push(<table key={`table-${index}`}><thead><tr>{(rows[0] ?? []).map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>);
            continue;
        }
        if (line.startsWith("- ")) {
            const items = [];
            while (lines[index]?.startsWith("- ")) items.push(lines[index++].slice(2));
            blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>);
            continue;
        }
        blocks.push(<p key={`paragraph-${index}`}>{line.replace(/^>\s*/, "")}</p>);
        index += 1;
    }
    return <article className="markdown-preview">{blocks}</article>;
}


export default function JournalTab({ onError, showToast, onOpenTask = () => {} }) {
    const [mode, setMode] = useState("events");
    const [logs, setLogs] = useState([]);
    const [reports, setReports] = useState([]);
    const [workflowReports, setWorkflowReports] = useState([]);
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
    const [workflowReportType, setWorkflowReportType] = useState("");
    const [workflowReportRange, setWorkflowReportRange] = useState("today");
    const [selectedLog, setSelectedLog] = useState(null);
    const [selectedReport, setSelectedReport] = useState(null);
    const [selectedWorkflowReport, setSelectedWorkflowReport] = useState(null);

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

    const loadWorkflowReports = async () => {
        setLoading(true);
        try {
            const now = new Date();
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            if (workflowReportRange === "week") start.setDate(start.getDate() - 6);
            setWorkflowReports(await unwrap(window.adsBot.getMarkdownReports({
                query,
                type: workflowReportType || undefined,
                dateFrom: start.toISOString(),
                dateTo: now.toISOString(),
            })));
        } catch (error) {
            fail(error, "Не вдалося завантажити робочі звіти");
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
            else if (mode === "reports") loadReports();
            else loadWorkflowReports();
        }, 200);
        return () => window.clearTimeout(timeout);
    }, [mode, query, level, scope, taskId, logTaskType, reportType, reportStatus, workflowReportType, workflowReportRange, dateFrom, dateTo]);

    const openReport = async (report) => {
        try {
            setSelectedReport(await unwrap(window.adsBot.getReport(report.id)));
        } catch (error) {
            fail(error, "Не вдалося відкрити звіт");
        }
    };

    const openWorkflowReport = async (report) => {
        try {
            setSelectedWorkflowReport(await unwrap(window.adsBot.getMarkdownReport(report.id)));
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
                <button className="secondary-button" disabled={loading} onClick={() => mode === "events" ? loadLogs() : mode === "reports" ? loadReports() : loadWorkflowReports()}><RefreshCw className={loading ? "spin" : ""} size={16} /> Оновити</button>
            </div>

            <div className="journal-mode-switch">
                <button className={mode === "events" ? "active" : ""} onClick={() => setMode("events")}><Terminal size={15} /> Події</button>
                <button className={mode === "reports" ? "active" : ""} onClick={() => setMode("reports")}><FileText size={15} /> Звіти</button>
                <button className={mode === "workflow-reports" ? "active" : ""} onClick={() => setMode("workflow-reports")}><FileText size={15} /> Робочі звіти</button>
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
                {mode === "workflow-reports" && <>
                    <label className="field"><span>Тип</span><select value={workflowReportType} onChange={(event) => setWorkflowReportType(event.target.value)}><option value="">Усі</option>{Object.entries(workflowReportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="field"><span>Період</span><select value={workflowReportRange} onChange={(event) => setWorkflowReportRange(event.target.value)}><option value="today">Сьогодні</option><option value="week">Останні 7 днів</option></select></label>
                </>}
                {mode !== "workflow-reports" && <><label className="field"><span>Від</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field"><span>До</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></>}
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
            {mode === "workflow-reports" && <div className="journal-table">
                {workflowReports.map((report) => <button className="journal-row report" key={report.id} onClick={() => openWorkflowReport(report)}><time>{new Date(report.createdAt).toLocaleString("uk-UA")}</time><b>{workflowReportLabels[report.type] || report.type}</b><span>Markdown</span><strong>{report.title}</strong></button>)}
                {!loading && !workflowReports.length && <div className="journal-empty">Робочих звітів за цими фільтрами немає.</div>}
            </div>}

            {(selectedLog || selectedReport || selectedWorkflowReport) && <div className="overlay" onMouseDown={() => { setSelectedLog(null); setSelectedReport(null); setSelectedWorkflowReport(null); }}><div className="modal journal-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
                <button className="modal-close" onClick={() => { setSelectedLog(null); setSelectedReport(null); setSelectedWorkflowReport(null); }}><X size={17} /></button>
                <span className="eyebrow">{selectedWorkflowReport ? "Markdown report" : selectedReport ? "Task report" : selectedLog?.scope}</span>
                <h2>{selectedWorkflowReport?.title || selectedReport?.title || selectedLog?.message}</h2>
                {selectedWorkflowReport ? <MarkdownPreview content={selectedWorkflowReport.content} /> : <pre>{JSON.stringify(selectedReport || selectedLog, null, 2)}</pre>}
                <div className="form-actions">
                    {selectedReport?.taskId && <button className="secondary-button" onClick={() => onOpenTask(selectedReport.taskId)}>Відкрити задачу</button>}
                    {selectedReport && <button className="secondary-button danger" onClick={deleteReport}><Trash2 size={15} /> Видалити</button>}
                    {selectedReport && <button className="secondary-button" onClick={exportReport}><Download size={15} /> Markdown</button>}
                    {selectedWorkflowReport && <button className="secondary-button" onClick={() => unwrap(window.adsBot.openLocalPath(selectedWorkflowReport.filePath)).catch((error) => fail(error, "Не вдалося відкрити файл звіту"))}><FileText size={15} /> Відкрити файл</button>}
                    <span className="action-spacer" /><button className="primary-button" onClick={() => { setSelectedLog(null); setSelectedReport(null); setSelectedWorkflowReport(null); }}>Закрити</button>
                </div>
            </div></div>}
        </motion.section>
    );
}
