import { useState } from "react";
import { motion } from "framer-motion";
import { LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";

import MultiSelect from "../components/MultiSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


export default function CommentsTab({
    groups,
    setGroups,
    selectedGroupIds,
    setSelectedGroupIds,
    form,
    setForm,
    onError,
    addLog,
}) {
    const [refreshing, setRefreshing] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);

    const update = (field) => (event) => {
        const value = field === "geo"
            ? event.target.value.toUpperCase().slice(0, 2)
            : event.target.value;
        setForm((current) => ({ ...current, [field]: value }));
    };

    const refreshGroups = async () => {
        setRefreshing(true);
        try {
            const nextGroups = await unwrap(window.adsBot.refreshAdsPowerGroups());
            setGroups(nextGroups);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося оновити групи" });
        } finally {
            setRefreshing(false);
        }
    };

    const canRun = selectedGroupIds.length > 0
        && form.geo.trim()
        && form.creativeName.trim()
        && form.postUrl.trim()
        && !running;

    const run = async (event) => {
        event.preventDefault();
        if (!canRun) return;

        setRunning(true);
        setResult(null);
        addLog("info", "frontend", "Запускаємо кампанію коментування");
        try {
            const summary = await unwrap(window.adsBot.runCommentingCampaign({
                groupIds: selectedGroupIds,
                ...form,
            }));
            setResult(summary);
            if (summary.fatalError) {
                onError({
                    title: "Кампанія завершилася помилкою",
                    message: summary.fatalError,
                });
            }
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося запустити коментарі" });
        } finally {
            setRunning(false);
        }
    };

    return (
        <motion.section className="tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="page-heading split">
                <div>
                    <span className="eyebrow">AdsPower automation</span>
                    <h1>Написати коментарі</h1>
                    <p>Коментарі пишуть браузерні профілі вибраних груп AdsPower.</p>
                </div>
                <button className="secondary-button" disabled={refreshing || running} onClick={refreshGroups}>
                    <RefreshCw className={refreshing ? "spin" : ""} size={16} /> Оновити групи
                </button>
            </div>

            <div className="notice info">Facebook API-акаунт зліва не використовується для коментування.</div>

            <form className="form-card" onSubmit={run}>
                <div className="section-label"><span>01</span> Групи AdsPower</div>
                <MultiSelect
                    items={groups}
                    value={selectedGroupIds}
                    onChange={setSelectedGroupIds}
                    disabled={running}
                />

                <div className="section-label"><span>02</span> Креатив і посилання</div>
                <div className="form-grid three">
                    <label className="field">
                        <span>Geo</span>
                        <input value={form.geo} onChange={update("geo")} placeholder="HU" />
                    </label>
                    <label className="field">
                        <span>Назва креативу</span>
                        <input value={form.creativeName} onChange={update("creativeName")} placeholder="138" />
                    </label>
                    <label className="field wide">
                        <span>Посилання на офер <small>необов’язково</small></span>
                        <input value={form.siteUrl} onChange={update("siteUrl")} placeholder="Залиште порожнім, щоб видалити <LINK>" />
                    </label>
                    <label className="field full">
                        <span>Посилання на Facebook-пост</span>
                        <input value={form.postUrl} onChange={update("postUrl")} placeholder="https://www.facebook.com/..." />
                    </label>
                </div>

                <div className="form-actions">
                    <span>{groups.length} груп у довіднику</span>
                    <button className="primary-button" type="submit" disabled={!canRun}>
                        {running ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />}
                        {running ? "Кампанія виконується…" : "Почати коментування"}
                    </button>
                </div>
            </form>

            {result && (
                <div className="summary-grid">
                    <article><span>Опубліковано</span><strong>{result.published}</strong></article>
                    <article><span>Пропущено</span><strong>{result.skipped}</strong></article>
                    <article><span>Помилки коментарів</span><strong>{result.failedComments}</strong></article>
                    <article><span>Проблемні профілі</span><strong>{result.failedProfiles}</strong></article>
                    <p className="report-path">Звіт: {result.reportPath || "не збережено"}</p>
                </div>
            )}
        </motion.section>
    );
}
