import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, LoaderCircle, Send } from "lucide-react";

import ImageDropzone from "../components/ImageDropzone.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


export default function PublishTab({
    selectedAccount,
    onError,
    onPostSuccess,
    addLog,
    pageId: controlledPageId,
    setPageId: setControlledPageId,
    form: controlledForm,
    setForm: setControlledForm,
}) {
    const [fanPages, setFanPages] = useState([]);
    const [localPageId, setLocalPageId] = useState("");
    const [loadingPages, setLoadingPages] = useState(false);
    const [pagesLoaded, setPagesLoaded] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [result, setResult] = useState(null);
    const [localForm, setLocalForm] = useState({
        geo: "",
        creativeName: "",
        siteUrl: "",
        imagePath: "",
    });
    const pageId = controlledPageId ?? localPageId;
    const setPageId = setControlledPageId ?? setLocalPageId;
    const form = controlledForm ?? localForm;
    const setForm = setControlledForm ?? setLocalForm;
    const accountActive = selectedAccount?.status === "active";

    useEffect(() => {
        setFanPages([]);
        setResult(null);
        setPagesLoaded(false);

        if (!accountActive) {
            return;
        }

        let active = true;
        setLoadingPages(true);
        unwrap(window.adsBot.getFanPages(selectedAccount.accountKey))
            .then((pages) => {
                if (active) {
                    setFanPages(pages);
                    setPageId((current) => pages.some(
                        (page) => page.id === current
                    ) ? current : "");
                }
            })
            .catch((error) => {
                if (active) onError(errorDetails(error));
            })
            .finally(() => {
                if (active) {
                    setLoadingPages(false);
                    setPagesLoaded(true);
                }
            });

        return () => {
            active = false;
        };
    }, [selectedAccount?.accountKey, accountActive]);

    const update = (field) => (event) => {
        const value = field === "geo"
            ? event.target.value.toUpperCase().slice(0, 2)
            : event.target.value;
        setForm((current) => ({ ...current, [field]: value }));
    };

    const canPublish = accountActive
        && pageId
        && form.geo.trim()
        && form.creativeName.trim()
        && form.siteUrl.trim()
        && !publishing;

    const publish = async (event) => {
        event.preventDefault();
        if (!canPublish) return;

        setPublishing(true);
        setResult(null);
        addLog("info", "frontend", `Запускаємо публікацію ${form.geo} ${form.creativeName}`);

        try {
            const post = await unwrap(window.adsBot.publishCreativePost({
                accountKey: selectedAccount.accountKey,
                pageId,
                ...form,
            }));
            setResult(post);
            onPostSuccess({ post, ...form });
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося опублікувати пост",
            });
        } finally {
            setPublishing(false);
        }
    };

    return (
        <motion.section className="tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="page-heading">
                <span className="eyebrow">Facebook Pages</span>
                <h1>Опублікувати креатив</h1>
                <p>Виберіть фанпейджу, підготуйте локалізований креатив і створіть перевірений пост.</p>
            </div>

            {!selectedAccount && <div className="notice">Оберіть Facebook-акаунт у лівій панелі.</div>}
            {selectedAccount && !accountActive && (
                <div className="notice danger">Акаунт неактивний. Graph API-дії заблоковано.</div>
            )}
            {accountActive && pagesLoaded && fanPages.length === 0 && (
                <div className="notice danger">
                    Facebook не повернув жодної доступної для публікації фанпейджі.
                </div>
            )}

            <form className="form-card" onSubmit={publish}>
                <div className="section-label"><span>01</span> Фанпейджа</div>
                <SearchSelect
                    items={fanPages}
                    value={pageId}
                    onChange={setPageId}
                    disabled={!accountActive || loadingPages}
                    placeholder={loadingPages ? "Завантажуємо фанпейджі…" : "Оберіть фанпейджу"}
                    searchPlaceholder="Пошук за ім’ям або ID…"
                />

                <div className="section-label"><span>02</span> Дані креативу</div>
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
                        <span>Посилання на офер</span>
                        <input value={form.siteUrl} onChange={update("siteUrl")} placeholder="https://example.com/offer" />
                    </label>
                </div>

                <div className="section-label"><span>03</span> Зображення <small>необов’язково</small></div>
                <ImageDropzone
                    value={form.imagePath}
                    onChange={(imagePath) => setForm((current) => ({ ...current, imagePath }))}
                    disabled={publishing}
                />

                <div className="form-actions">
                    <span>{fanPages.length} доступних фанпейджів</span>
                    <button className="primary-button" type="submit" disabled={!canPublish}>
                        {publishing ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                        {publishing ? "Публікуємо…" : "Запостити креатив"}
                    </button>
                </div>
            </form>

            {result && (
                <motion.div className="success-card" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                    <div><span className="status-dot active" /><strong>Пост опубліковано та перевірено</strong></div>
                    <dl>
                        <div><dt>Post ID</dt><dd>{result.postId}</dd></div>
                        <div><dt>Тип</dt><dd>{result.type}</dd></div>
                    </dl>
                    <button className="link-button" onClick={() => window.adsBot.openExternal(result.permalinkUrl)}>
                        Відкрити пост <ExternalLink size={15} />
                    </button>
                </motion.div>
            )}
        </motion.section>
    );
}
