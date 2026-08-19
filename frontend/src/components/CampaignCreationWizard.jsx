import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    BadgeCheck,
    CircleAlert,
    ImageIcon,
    LoaderCircle,
    Play,
    RefreshCw,
    RotateCcw,
    Search,
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
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [pagesLoading, setPagesLoading] = useState(true);
    const [pagesError, setPagesError] = useState(null);
    const [pagesNotice, setPagesNotice] = useState("");
    const [pageQuery, setPageQuery] = useState("");
    const [pageMenuOpen, setPageMenuOpen] = useState(false);
    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(false);
    const [postsError, setPostsError] = useState(null);
    const [postQuery, setPostQuery] = useState("");
    const [postMenuOpen, setPostMenuOpen] = useState(false);
    const [selectedPost, setSelectedPost] = useState(null);
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
    const pagesRequest = useRef(0);
    const postsRequest = useRef(0);

    useEffect(() => {
        let active = true;
        unwrap(window.adsBot.getTemplates()).then((nextTemplates) => {
            if (!active) return;
            setTemplates(nextTemplates);
            setForm((current) => ({
                ...current,
                templateId: String(nextTemplates[0]?.id ?? ""),
            }));
        }).catch((error) => {
            if (active) setFailure(errorDetails(error));
        }).finally(() => {
            if (active) setTemplatesLoading(false);
        });
        return () => { active = false; };
    }, []);

    const refreshPages = useCallback(async () => {
        const requestId = ++pagesRequest.current;
        setPagesLoading(true);
        setPagesError(null);
        setPagesNotice("");
        try {
            const nextPages = await unwrap(window.adsBot.getFanPages(accountKey));
            if (requestId !== pagesRequest.current) return;
            setPages(nextPages);
            setForm((current) => {
                if (!current.pageId) {
                    return {
                        ...current,
                        pageId: String(nextPages[0]?.id ?? ""),
                    };
                }
                if (nextPages.some((page) => String(page.id) === current.pageId)) {
                    return current;
                }
                setPageQuery("");
                setPostQuery("");
                setSelectedPost(null);
                setPagesNotice("Раніше вибрана фанпейджа більше недоступна. Оберіть іншу сторінку.");
                return { ...current, pageId: "", postId: "" };
            });
        } catch (error) {
            if (requestId === pagesRequest.current) {
                setPagesError(errorDetails(error));
            }
        } finally {
            if (requestId === pagesRequest.current) setPagesLoading(false);
        }
    }, [accountKey]);

    useEffect(() => {
        refreshPages();
    }, [refreshPages]);

    const loadPosts = useCallback(async (pageId) => {
        if (!pageId) return;
        const requestId = ++postsRequest.current;
        setPostsLoading(true);
        setPostsError(null);
        try {
            const result = await unwrap(
                window.adsBot.getCampaignPagePosts(
                    accountKey,
                    pageId,
                    10
                )
            );
            if (requestId !== postsRequest.current) return;
            setPosts(result);
        } catch (error) {
            if (requestId === postsRequest.current) {
                setPostsError(errorDetails(error));
            }
        } finally {
            if (requestId === postsRequest.current) setPostsLoading(false);
        }
    }, [accountKey]);

    useEffect(() => {
        postsRequest.current += 1;
        setPosts([]);
        setPostsError(null);
        setSelectedPost(null);
        setPostQuery("");
        setForm((current) => ({ ...current, postId: "" }));
        if (form.pageId) loadPosts(form.pageId);
    }, [form.pageId, loadPosts]);

    useEffect(() => {
        return window.adsBot.onCampaignCreationProgress((event) => {
            setJobId((current) => current ?? event.jobId);
            setProgress(event);
            if (event.error) setFailure(event.error);
        });
    }, []);

    const selectedPage = pages.find(
        (page) => String(page.id) === form.pageId
    );
    const filteredPages = useMemo(() => {
        const query = pageQuery.trim().toLocaleLowerCase();
        if (!query || pageQuery === `${selectedPage?.name ?? ""} · ${selectedPage?.id ?? ""}`) {
            return pages;
        }
        return pages.filter((page) => (
            `${page.name} ${page.id}`.toLocaleLowerCase().includes(query)
        ));
    }, [pageQuery, pages, selectedPage]);
    const filteredPosts = useMemo(() => {
        const query = postQuery.trim().toLocaleLowerCase();
        if (!query || query === String(selectedPost?.id ?? "").toLocaleLowerCase()) {
            return posts;
        }
        return posts.filter((post) => (
            `${post.id} ${post.message}`
                .toLocaleLowerCase()
                .includes(query)
        ));
    }, [postQuery, posts, selectedPost]);

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

    useEffect(() => {
        if (selectedPage) {
            setPageQuery(`${selectedPage.name} · ${selectedPage.id}`);
        }
    }, [selectedPage?.id]);

    const selectPage = (page) => {
        setPageQuery(`${page.name} · ${page.id}`);
        setPageMenuOpen(false);
        change("pageId", String(page.id));
    };

    const selectPost = (post) => {
        setSelectedPost(post);
        setPostQuery(String(post.id));
        setPostMenuOpen(false);
        change("postId", String(post.id));
    };

    const editPostQuery = (value) => {
        setPostQuery(value);
        setSelectedPost(null);
        setForm((current) => ({ ...current, postId: "" }));
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
            const result = await unwrap(
                window.adsBot.preflightCampaignCreation(payload())
            );
            setVerified(result);
            if (result.postId) {
                setForm((current) => ({ ...current, postId: result.postId }));
                setPostQuery(result.postId);
            }
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

                    <form onSubmit={check} className="campaign-wizard-form">
                        <div className="template-editor-fields two-columns">
                            <label className="field"><span>Назва кампанії</span><input autoFocus value={form.campaignName} onChange={(event) => change("campaignName", event.target.value)} placeholder="HU Leads 20.08" /></label>
                            <label className="field"><span>Шаблон</span><select value={form.templateId} disabled={templatesLoading} onChange={(event) => change("templateId", event.target.value)}><option value="">{templatesLoading ? "Оновлюємо шаблони…" : "Оберіть шаблон"}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · Pixel {template.pixel || "—"}</option>)}</select></label>

                            <div className="field full-row campaign-resource-field">
                                <span>Фанпейджа</span>
                                <div className="campaign-combobox-row">
                                    <div className="campaign-combobox">
                                        <Search size={15} />
                                        <input
                                            aria-label="Пошук фанпейджі"
                                            role="combobox"
                                            aria-expanded={pageMenuOpen}
                                            value={pageQuery}
                                            onFocus={(event) => {
                                                event.target.select();
                                                setPageMenuOpen(true);
                                            }}
                                            onBlur={() => setTimeout(() => setPageMenuOpen(false), 120)}
                                            onChange={(event) => {
                                                setPageQuery(event.target.value);
                                                setPageMenuOpen(true);
                                            }}
                                            placeholder="Пошук за назвою або ID"
                                        />
                                        {pagesLoading && <LoaderCircle className="spin" size={15} />}
                                        {pageMenuOpen && (
                                            <div className="campaign-combobox-menu">
                                                {filteredPages.map((page) => (
                                                    <button type="button" key={page.id} onClick={() => selectPage(page)} className={String(page.id) === form.pageId ? "selected" : ""}>
                                                        <strong>{page.name}</strong><small>{page.id}</small>
                                                    </button>
                                                ))}
                                                {!pagesLoading && !filteredPages.length && <div className="campaign-combobox-empty">Фанпейдж не знайдено</div>}
                                            </div>
                                        )}
                                    </div>
                                    <button type="button" className="icon-button resource-refresh" title="Оновити фанпейджі" aria-label="Оновити фанпейджі" disabled={pagesLoading} onClick={refreshPages}><RefreshCw className={pagesLoading ? "spin" : ""} size={16} /></button>
                                </div>
                                {pagesError && <div className="resource-inline-error"><span>{pagesError.message}</span><button type="button" onClick={refreshPages}>Повторити</button></div>}
                                {pagesNotice && <div className="resource-inline-notice">{pagesNotice}</div>}
                            </div>

                            <div className="field full-row campaign-resource-field">
                                <span>Пост для реклами</span>
                                <div className="campaign-combobox-row">
                                    <div className="campaign-combobox">
                                        <Search size={15} />
                                        <input
                                            aria-label="Пошук поста"
                                            role="combobox"
                                            aria-expanded={postMenuOpen}
                                            value={postQuery}
                                            disabled={!form.pageId}
                                            onFocus={(event) => {
                                                event.target.select();
                                                setPostMenuOpen(true);
                                            }}
                                            onBlur={() => setTimeout(() => setPostMenuOpen(false), 120)}
                                            onChange={(event) => {
                                                editPostQuery(event.target.value);
                                                setPostMenuOpen(true);
                                            }}
                                            placeholder="Пошук серед 10 останніх постів"
                                        />
                                        {postsLoading && <LoaderCircle className="spin" size={15} />}
                                        {postMenuOpen && form.pageId && (
                                            <div className="campaign-combobox-menu posts-menu">
                                                {filteredPosts.map((post) => (
                                                    <button type="button" key={post.id} onClick={() => selectPost(post)} className={String(post.id) === form.postId ? "selected" : ""}>
                                                        <strong>{post.id}</strong><small>{post.message || "Пост без тексту"}</small>
                                                    </button>
                                                ))}
                                                {!postsLoading && !filteredPosts.length && <div className="campaign-combobox-empty">Серед завантажених постів збігів немає</div>}
                                            </div>
                                        )}
                                    </div>
                                    <button type="button" className="icon-button resource-refresh" title="Оновити пости" aria-label="Оновити пости" disabled={!form.pageId || postsLoading} onClick={() => loadPosts(form.pageId)}><RefreshCw className={postsLoading ? "spin" : ""} size={16} /></button>
                                </div>
                                <small className="field-hint">Показуються 10 найновіших опублікованих постів. Найновіший завжди зверху.</small>
                                {postsError && <div className="resource-inline-error"><span>{postsError.message}</span><button type="button" onClick={() => loadPosts(form.pageId)}>Повторити</button></div>}
                            </div>

                            {selectedPost && (
                                <div className="campaign-post-preview full-row">
                                    <div className="campaign-post-image">
                                        {selectedPost.thumbnailUrl ? <img src={selectedPost.thumbnailUrl} alt="Прев’ю поста" /> : <ImageIcon size={25} />}
                                    </div>
                                    <div>
                                        <strong>{selectedPost.id}</strong>
                                        <p>{selectedPost.message || "Пост без тексту"}</p>
                                        <small>{selectedPost.createdTime ? new Date(selectedPost.createdTime).toLocaleString("uk-UA") : "Дата не вказана"}{selectedPost.type ? ` · ${selectedPost.type}` : ""}</small>
                                    </div>
                                </div>
                            )}
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
            </motion.div>
        </div>
    );
}
