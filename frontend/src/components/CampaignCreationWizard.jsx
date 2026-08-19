import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    BadgeCheck,
    CircleAlert,
    LoaderCircle,
    Play,
    RotateCcw,
    ShieldCheck,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


function localValueInZone(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date);
        const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
    } catch {
        return date.toISOString().slice(0, 16);
    }
}


function zonedValueToIso(value, timeZone) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return "";
    const [, year, month, day, hour, minute] = match.map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let guess = target;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(guess));
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const represented = Date.UTC(
            Number(map.year),
            Number(map.month) - 1,
            Number(map.day),
            Number(map.hour),
            Number(map.minute),
            Number(map.second)
        );
        guess = target - (represented - guess);
    }
    return new Date(guess).toISOString();
}


function stageLabel(stage) {
    return ({
        preflight: "Перевірка доступів",
        "preflight-complete": "Перевірку завершено",
        campaign: "Campaign створено",
        creative: "Creative створено",
        adset: "Створення ad sets",
        ad: "Створення ads",
        readback: "Контрольне читання",
        activation: "Активація",
        complete: "Готово",
        failed: "Помилка",
        cleanup: "Очищення",
    })[stage] ?? stage;
}


export default function CampaignCreationWizard({
    accountKey,
    adAccount,
    createPaused,
    onClose,
    onSuccess,
}) {
    const timezone = adAccount.timezoneName || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [templates, setTemplates] = useState([]);
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState({
        campaignName: "",
        templateId: "",
        pageId: "",
        postId: "",
        adSetCount: 5,
        dailyBudget: 5,
        startTime: localValueInZone(new Date(), timezone),
    });
    const [verified, setVerified] = useState(null);
    const [checking, setChecking] = useState(false);
    const [creating, setCreating] = useState(false);
    const [progress, setProgress] = useState(null);
    const [failure, setFailure] = useState(null);
    const [warnings, setWarnings] = useState([]);
    const [jobId, setJobId] = useState(null);

    useEffect(() => {
        Promise.all([
            unwrap(window.adsBot.getTemplates()),
            unwrap(window.adsBot.getFanPages(accountKey)),
        ]).then(([nextTemplates, nextPages]) => {
            setTemplates(nextTemplates);
            setPages(nextPages);
            setForm((current) => ({
                ...current,
                templateId: String(nextTemplates[0]?.id ?? ""),
                pageId: String(nextPages[0]?.id ?? ""),
            }));
        }).catch((error) => setFailure(errorDetails(error))).finally(() => setLoading(false));

        return window.adsBot.onCampaignCreationProgress((event) => {
            setJobId((current) => current ?? event.jobId);
            setProgress(event);
            if (event.error) setFailure(event.error);
        });
    }, [accountKey]);

    const selectedTemplate = templates.find(
        (template) => String(template.id) === form.templateId
    );
    const totalBudget = useMemo(
        () => Number(form.adSetCount || 0) * Number(form.dailyBudget || 0),
        [form.adSetCount, form.dailyBudget]
    );

    const payload = () => ({
        accountKey,
        adAccountId: adAccount.id,
        templateId: Number(form.templateId),
        campaignName: form.campaignName.trim(),
        pageId: form.pageId,
        postId: form.postId.trim(),
        adSetCount: Number(form.adSetCount),
        dailyBudget: Number(form.dailyBudget),
        startTime: zonedValueToIso(form.startTime, timezone),
        createPaused,
    });

    const change = (field, value) => {
        setForm((current) => ({ ...current, [field]: value }));
        setVerified(null);
        setFailure(null);
    };

    const canCheck = form.campaignName.trim()
        && form.templateId
        && form.pageId
        && form.postId.trim()
        && Number(form.adSetCount) > 0
        && Number(form.dailyBudget) > 0
        && form.startTime;

    const check = async (event) => {
        event.preventDefault();
        if (!canCheck || checking) return;
        setChecking(true);
        setFailure(null);
        try {
            setVerified(await unwrap(
                window.adsBot.preflightCampaignCreation(payload())
            ));
        } catch (error) {
            setFailure(errorDetails(error));
        } finally {
            setChecking(false);
        }
    };

    const create = async () => {
        setCreating(true);
        setFailure(null);
        setProgress({ stage: "preflight", completed: 0, total: 3 + Number(form.adSetCount) * 2 });
        try {
            const response = await unwrap(window.adsBot.startCampaignCreation(payload()));
            setWarnings(response.result?.readback?.warnings ?? []);
            setJobId(response.job.id);
            setProgress({
                stage: "complete",
                completed: response.job.total,
                total: response.job.total,
                objects: response.job.objects,
            });
            onSuccess?.(response);
        } catch (error) {
            const details = errorDetails(error);
            setFailure(details);
            if (error.jobId) setJobId(error.jobId);
        } finally {
            setCreating(false);
        }
    };

    const retry = async () => {
        if (!jobId) return;
        setCreating(true);
        setFailure(null);
        try {
            const response = await unwrap(window.adsBot.retryCampaignCreation(jobId));
            setWarnings(response.result?.readback?.warnings ?? []);
            setProgress({ stage: "complete", completed: response.job.total, total: response.job.total, objects: response.job.objects });
            onSuccess?.(response);
        } catch (error) {
            setFailure(errorDetails(error));
        } finally {
            setCreating(false);
        }
    };

    const cleanup = async () => {
        if (!jobId || !window.confirm("Видалити всі об’єкти, створені цією спробою?")) return;
        setCreating(true);
        try {
            const result = await unwrap(window.adsBot.cleanupCampaignCreation(jobId));
            setProgress({ stage: "cleanup", completed: result.deleted.length, total: result.deleted.length + result.failed.length });
            if (result.failed.length) {
                setFailure({ message: `Не вдалося видалити ${result.failed.length} об’єктів`, code: "CAMPAIGN_CLEANUP_PARTIAL" });
            }
        } catch (error) {
            setFailure(errorDetails(error));
        } finally {
            setCreating(false);
        }
    };

    const percent = progress?.total
        ? Math.min(100, Math.round((progress.completed ?? 0) / progress.total * 100))
        : 0;

    return (
        <div className="overlay campaign-wizard-overlay" onMouseDown={() => !creating && onClose()}>
            <motion.div className="modal campaign-wizard" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onMouseDown={(event) => event.stopPropagation()}>
                <button className="modal-close" disabled={creating} onClick={onClose}><X size={17} /></button>
                <div className="modal-icon campaign-icon"><Play /></div>
                <span className="eyebrow">Website leads · {adAccount.localName}</span>
                <h2>Створити кампанію за шаблоном</h2>
                <p>{adAccount.currency} · {timezone} · усі об’єкти спочатку створюються PAUSED</p>

                {loading ? <div className="wizard-loading"><LoaderCircle className="spin" /> Завантажуємо шаблони й фанпейджі…</div> : (
                    <form onSubmit={check} className="campaign-wizard-form">
                        <div className="template-editor-fields two-columns">
                            <label className="field"><span>Назва кампанії</span><input autoFocus value={form.campaignName} onChange={(event) => change("campaignName", event.target.value)} placeholder="HU Leads 20.08" /></label>
                            <label className="field"><span>Шаблон</span><select value={form.templateId} onChange={(event) => change("templateId", event.target.value)}><option value="">Оберіть шаблон</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · Pixel {template.pixel || "—"}</option>)}</select></label>
                            <label className="field"><span>Фанпейджа</span><select value={form.pageId} onChange={(event) => change("pageId", event.target.value)}><option value="">Оберіть фанпейджу</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select></label>
                            <label className="field"><span>Post ID</span><input value={form.postId} onChange={(event) => change("postId", event.target.value)} placeholder="123456789 або pageId_postId" /></label>
                            <label className="field"><span>Кількість ad sets</span><input type="number" min="1" max="100" value={form.adSetCount} onChange={(event) => change("adSetCount", event.target.value)} /></label>
                            <label className="field"><span>Бюджет одного ad set, {adAccount.currency}</span><input type="number" min="0.01" step="0.01" value={form.dailyBudget} onChange={(event) => change("dailyBudget", event.target.value)} /></label>
                            <label className="field full-row"><span>Початок показів · {timezone}</span><input type="datetime-local" value={form.startTime} onChange={(event) => change("startTime", event.target.value)} /></label>
                        </div>

                        <div className="campaign-summary">
                            <div><span>Ad sets / ads</span><strong>{form.adSetCount || 0} / {form.adSetCount || 0}</strong></div>
                            <div><span>Денний бюджет</span><strong>{Number.isFinite(totalBudget) ? totalBudget : 0} {adAccount.currency}</strong></div>
                            <div><span>Статус після створення</span><strong>{createPaused ? "PAUSED" : "ACTIVE"}</strong></div>
                            <div><span>Аудиторія</span><strong>{selectedTemplate?.countryCodes?.join(", ") || "—"}</strong></div>
                        </div>

                        {verified && !progress && (
                            <div className="preflight-success">
                                <ShieldCheck size={20} />
                                <div>
                                    <strong>Preflight пройдено</strong>
                                    <span>Сторінка «{verified.pageName}», Pixel {verified.pixel?.name || verified.pixel?.id}, бюджет у {verified.currency}.</span>
                                    {verified.dsa && (
                                        <span>
                                            DSA: бенефіціар «{verified.dsa.beneficiary}» ({verified.dsa.beneficiarySource === "template" ? "Шаблон" : "Meta default"}); платник «{verified.dsa.payor}» ({verified.dsa.payorSource === "template" ? "Шаблон" : "Meta default"}).
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {progress && (
                            <div className={`creation-progress ${progress.stage === "failed" ? "failed" : ""}`}>
                                <div><span>{stageLabel(progress.stage)}</span><strong>{percent}%</strong></div>
                                <div className="progress-track"><i style={{ width: `${percent}%` }} /></div>
                                <small>{progress.message || `${progress.completed ?? 0} з ${progress.total ?? "—"} елементів`}</small>
                                {progress.stage === "complete" && <div className="creation-complete"><BadgeCheck size={18} /> Campaign ID: {progress.objects?.campaignId}</div>}
                            </div>
                        )}

                        {failure && (
                            <div className="creation-error"><CircleAlert size={19} /><div><strong>{failure.message}</strong><span>{failure.stage ? `Етап: ${stageLabel(failure.stage)}. ` : ""}{failure.code ? `Код: ${failure.code}` : ""}{failure.graphCode ? ` · Meta ${failure.graphCode}/${failure.graphSubcode || "—"}` : ""}</span></div></div>
                        )}
                        {warnings.map((warning) => (
                            <div className="notice info" key={warning}>{warning}</div>
                        ))}

                        <div className="form-actions campaign-wizard-actions">
                            {failure && jobId && <>{failure.code !== "FACEBOOK_WRITE_OUTCOME_UNKNOWN" && <button type="button" className="secondary-button" disabled={creating} onClick={retry}><RotateCcw size={15} /> Повторити</button>}<button type="button" className="secondary-button danger" disabled={creating} onClick={cleanup}><Trash2 size={15} /> Видалити відомі об’єкти</button></>}
                            <span className="action-spacer" />
                            <button type="button" className="secondary-button" disabled={creating} onClick={onClose}>Закрити</button>
                            {!verified && <button className="primary-button" type="submit" disabled={!canCheck || checking || creating}>{checking ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />} Перевірити дані</button>}
                            {verified && progress?.stage !== "complete" && <button className="primary-button" type="button" disabled={creating} onClick={create}>{creating ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Створити {createPaused ? "на паузі" : "й активувати"}</button>}
                        </div>
                    </form>
                )}
            </motion.div>
        </div>
    );
}
