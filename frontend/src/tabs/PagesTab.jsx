import { useEffect, useMemo, useRef, useState } from "react";
import {
    CircleMinus,
    CirclePlus,
    Copy,
    ExternalLink,
    FolderOpen,
    LoaderCircle,
    Megaphone,
    MessageSquareText,
    Pencil,
    RefreshCw,
    RotateCcw,
    Rocket,
    Send,
    Trash2,
    TriangleAlert,
    X,
} from "lucide-react";

import AdAccountSelect from "../components/AdAccountSelect.jsx";
import CampaignCreationWizard from "../components/CampaignCreationWizard.jsx";
import CreativeLaunchModal from "../components/CreativeLaunchModal.jsx";
import GeoSelect from "../components/GeoSelect.jsx";
import ImageListDropzone from "../components/ImageListDropzone.jsx";
import MultiSelect from "../components/MultiSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";
import { findGroupForGeo } from "../lib/groups.js";


const compare = (left, right) => String(left.name || "").localeCompare(
    String(right.name || ""),
    "uk-UA",
    { numeric: true, sensitivity: "base" }
);
const marker = (value) => value
    ? `Creo_${String(value).replace(/^Creo_/i, "")}`
    : "Empty";


function CopyButton({ value, label }) {
    return (
        <button
            type="button"
            className="page-copy-button"
            title={`Копіювати ${label}`}
            onClick={(event) => {
                event.stopPropagation();
                navigator.clipboard.writeText(String(value));
            }}
        >
            <Copy size={14} />
        </button>
    );
}


function StableImage({ src, alt = "", fallback = null }) {
    const [displayedSrc, setDisplayedSrc] = useState(src || "");

    useEffect(() => {
        if (!src || src === displayedSrc) return undefined;
        let active = true;
        const image = new Image();
        image.onload = () => {
            if (active) setDisplayedSrc(src);
        };
        image.src = src;
        return () => {
            active = false;
            image.onload = null;
        };
    }, [src, displayedSrc]);

    if (!displayedSrc) return fallback;
    return (
        <img
            src={displayedSrc}
            alt={alt}
            onError={() => setDisplayedSrc("")}
        />
    );
}


function PageCard({ page, selected, onSelect, onFavorite }) {
    return (
        <div
            className={`page-card ${selected ? "selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(page.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(page.id);
            }}
        >
            <span className="page-avatar">
                <StableImage
                    src={page.pictureUrl}
                    fallback={String(page.name || "P").slice(0, 1).toUpperCase()}
                />
            </span>
            <strong className="page-card-geo">{page.geo || "—"}</strong>
            <span className="page-card-value page-card-name">
                <strong>{page.name}</strong>
                <CopyButton value={page.name} label="назву фанпейджі" />
            </span>
            <span className="page-card-value page-card-id">
                <small>ID: {page.id}</small>
                <CopyButton value={page.id} label="ID фанпейджі" />
            </span>
            <b className="page-card-creative">{marker(page.creativeName)}</b>
            <button
                type="button"
                className="ad-card-action"
                title={page.isFavorite ? "Забрати з обраних" : "Додати до обраних"}
                onClick={(event) => {
                    event.stopPropagation();
                    onFavorite(page, !page.isFavorite);
                }}
            >
                {page.isFavorite
                    ? <CircleMinus size={17} />
                    : <CirclePlus size={17} />}
            </button>
        </div>
    );
}


function PageRebuildModal({
    page,
    accountKey,
    onClose,
    onQueued,
    onError,
}) {
    const [requirements, setRequirements] = useState(null);
    const [imagePaths, setImagePaths] = useState([]);
    const [pageCreatedAt, setPageCreatedAt] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        unwrap(window.adsBot.getPageRebuildRequirements(accountKey, page.id))
            .then((value) => {
                if (active) setRequirements(value);
            })
            .catch((error) => {
                if (active) onError(errorDetails(error));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [accountKey, page.id, onError]);

    const chooseImages = async () => {
        try {
            const selected = await unwrap(
                window.adsBot.selectPageRebuildImages()
            );
            if (selected?.length) setImagePaths(selected);
        } catch (error) {
            onError(errorDetails(error));
        }
    };
    const submit = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const result = await unwrap(window.adsBot.startPageRebuild({
                accountKey,
                pageId: page.id,
                imagePaths,
                ...(requirements?.requiresPageCreatedAt
                    ? { pageCreatedAt }
                    : {}),
            }));
            onQueued(result);
        } catch (error) {
            onError(errorDetails(error));
        } finally {
            setSaving(false);
        }
    };
    const canSubmit = Boolean(
        requirements
        && imagePaths.length >= 3
        && confirmed
        && (!requirements.requiresPageCreatedAt || pageCreatedAt)
    );

    return (
        <div className="overlay">
            <form className="modal page-rebuild-modal" onSubmit={submit}>
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">Fanpage {page.id}</span>
                <h2>Пересетапити {page.name}</h2>

                <div className="page-rebuild-warning">
                    <TriangleAlert size={24} />
                    <div>
                        <strong>Увага: це незворотна операція</strong>
                        <p>
                            Усі старі пости та фотографії цієї фанки видаляться
                            к хрінам. Відновити їх буде неможливо.
                        </p>
                    </div>
                </div>

                <div className="page-rebuild-instructions">
                    <strong>Як підготувати папку</strong>
                    <p><code>1.*</code> — фото на avatar.</p>
                    <p><code>2.*</code> — фото на обкладинку.</p>
                    <p>Усі інші фотографії будуть опубліковані як пости.</p>
                    <small>
                        Якщо 1.* або 2.* відсутнє чи не підходить за розміром,
                        backend автоматично вибере інше придатне фото.
                    </small>
                </div>

                <label className="field">
                    <span>Папка з фотографіями</span>
                    <div className="page-rebuild-folder-row">
                        <input
                            readOnly
                            value={imagePaths.map((file) => file.split(/[\\/]/).pop()).join(", ")}
                            title={imagePaths.join("\n")}
                            placeholder="Папку не вибрано"
                        />
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={chooseImages}
                            disabled={saving}
                        >
                            <FolderOpen size={16} />
                            Вибрати папку
                        </button>
                    </div>
                </label>

                {loading && (
                    <div className="page-rebuild-requirements">
                        <LoaderCircle className="spin" size={16} />
                        Перевіряємо доступ до фанпейджа…
                    </div>
                )}
                {requirements?.requiresPageCreatedAt && (
                    <label className="field">
                        <span>Дата створення фанпейджа</span>
                        <input
                            type="date"
                            aria-label="Дата створення фанпейджа"
                            max={new Date().toISOString().slice(0, 10)}
                            value={pageCreatedAt}
                            onChange={(event) => setPageCreatedAt(event.target.value)}
                            required
                        />
                        <small>Meta не повернула дату — вкажіть її вручну.</small>
                    </label>
                )}

                <label className="page-rebuild-confirmation">
                    <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>Я розумію, що всі старі пости й фото буде видалено</span>
                </label>

                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        className="danger-button page-rebuild-submit"
                        disabled={!canSubmit || saving || loading}
                    >
                        {saving
                            ? <LoaderCircle className="spin" size={16} />
                            : <RotateCcw size={16} />}
                        Пересетапити фанку
                    </button>
                </div>
            </form>
        </div>
    );
}


function PublicationModal({
    page, accountKey, countries, groups, settings, onClose, onQueued, onError,
}) {
    const defaultGroup = findGroupForGeo(groups, page.geo);
    const [draft, setDraft] = useState({
        geo: page.geo || "",
        creativeName: page.creativeName || "",
        siteUrl: "",
        imagePath: "",
        imagePaths: [],
        disableComments: false,
        groupIds: defaultGroup ? [String(defaultGroup.groupId)] : [],
    });
    const [saving, setSaving] = useState(false);
    const submit = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            onQueued(await unwrap(window.adsBot.publishCreativePost({
                ...draft,
                accountKey,
                pageId: page.id,
                commentGroupIds: draft.disableComments ? [] : draft.groupIds,
                commentBrowserMode: settings.commentBrowserMode,
                commentDisableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
                commentWorkerProxyIds: settings.commentWorkerProxyIds,
            })));
        } catch (error) {
            onError(errorDetails(error));
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="overlay">
            <form className="modal action-modal" onSubmit={submit}>
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">Фанпейджа {page.id}</span>
                <h2>Запостити креатив</h2>
                <div className="creative-fields-row">
                    <label className="field geo-field">
                        <span>GEO</span>
                        <GeoSelect
                            countries={countries}
                            value={draft.geo}
                            onChange={(geo) => setDraft((current) => ({ ...current, geo }))}
                        />
                    </label>
                    <label className="field">
                        <span>Креатив</span>
                        <input
                            value={draft.creativeName}
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                creativeName: event.target.value.replace(/^Creo_/i, ""),
                            }))}
                        />
                    </label>
                </div>
                <label className="field">
                    <span>Offer URL</span>
                    <input
                        type="url"
                        value={draft.siteUrl}
                        onChange={(event) => setDraft((current) => ({
                            ...current,
                            siteUrl: event.target.value,
                        }))}
                    />
                </label>
                <label className="field">
                    <span>Зображення</span>
                    <ImageListDropzone
                        value={draft.imagePaths}
                        onChange={(imagePaths) => setDraft((current) => ({
                            ...current,
                            imagePaths,
                            imagePath: "",
                        }))}
                        disabled={saving}
                    />
                </label>
                <label className="publication-comments-toggle">
                    <input
                        type="checkbox"
                        aria-label="Вимкнути коментування"
                        checked={draft.disableComments}
                        onChange={(event) => setDraft((current) => ({
                            ...current,
                            disableComments: event.target.checked,
                        }))}
                        disabled={saving}
                    />
                    <span>
                        <strong>Вимкнути коментування</strong>
                        <small>Після публікації пост залишиться без коментарів.</small>
                    </span>
                </label>
                <fieldset className={`publication-comments-settings ${draft.disableComments ? "disabled" : ""}`} disabled={draft.disableComments || saving}>
                    <legend>Акаунти для коментарів</legend>
                    <p>Після успішної публікації пост буде автоматично прокоментований.</p>
                    <MultiSelect
                        items={groups}
                        value={draft.groupIds}
                        onChange={(groupIds) => setDraft((current) => ({ ...current, groupIds }))}
                    />
                </fieldset>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        className="primary-button"
                        disabled={saving || !draft.geo || !draft.creativeName || !draft.siteUrl || (!draft.disableComments && !draft.groupIds.length)}
                    >
                        {draft.disableComments ? "Опублікувати" : "Опублікувати та прокоментувати"}
                    </button>
                </div>
            </form>
        </div>
    );
}


function CommentModal({
    page, post = null, commentTarget = "post", accountKey, countries, groups,
    settings, onClose, onQueued, onError,
}) {
    const isAd = commentTarget === "ad";
    const defaultGroup = findGroupForGeo(groups, page.geo);
    const [draft, setDraft] = useState({
        geo: page.geo || "",
        creativeName: page.creativeName || "",
        siteUrl: "",
        postUrl: post?.permalinkUrl || "",
        groupIds: defaultGroup ? [String(defaultGroup.groupId)] : [],
    });
    const submit = async (event) => {
        event.preventDefault();
        try {
            onQueued(await unwrap(window.adsBot.runCommentingCampaign({
                ...draft,
                accountKey,
                commentTarget,
                browserMode: settings.commentBrowserMode,
                disableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
                commentWorkerProxyIds: settings.commentWorkerProxyIds,
            })));
        } catch (error) {
            onError(errorDetails(error));
        }
    };
    return (
        <div className="overlay">
            <form className="modal action-modal" onSubmit={submit}>
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">
                    {post ? `Пост ${post.id}` : isAd ? "Рекламна об’ява" : "Facebook-пост"}
                </span>
                <h2>{isAd ? "Закоментити рекламну об’яву" : "Закоментити пост"}</h2>
                <label className="field">
                    <span>Посилання на {isAd ? "рекламну об’яву" : "пост"}</span>
                    <input
                        type="url"
                        value={draft.postUrl}
                        onChange={(event) => setDraft((current) => ({
                            ...current,
                            postUrl: event.target.value,
                        }))}
                        placeholder="https://www.facebook.com/..."
                    />
                </label>
                <div className="creative-fields-row comment-creative-fields-row">
                    <label className="field geo-field">
                        <span>GEO</span>
                        <GeoSelect
                            countries={countries}
                            value={draft.geo}
                            onChange={(geo) => setDraft((current) => ({ ...current, geo }))}
                            layout="list"
                        />
                    </label>
                    <label className="field">
                        <span>Креатив</span>
                        <input
                            value={draft.creativeName}
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                creativeName: event.target.value.replace(/^Creo_/i, ""),
                            }))}
                        />
                    </label>
                </div>
                <label className="field">
                    <span>Offer URL (необов’язково)</span>
                    <input
                        value={draft.siteUrl}
                        onChange={(event) => setDraft((current) => ({
                            ...current,
                            siteUrl: event.target.value,
                        }))}
                    />
                </label>
                {isAd && (
                    <div className="notice info comment-ad-hint">
                        Реплаї будуть опубліковані як окремі звичайні коментарі.
                    </div>
                )}
                <label className="field">
                    <span>Акаунти для коментарів</span>
                    <MultiSelect
                        items={groups}
                        value={draft.groupIds}
                        onChange={(groupIds) => setDraft((current) => ({
                            ...current,
                            groupIds,
                        }))}
                    />
                </label>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        className="primary-button"
                        disabled={!draft.postUrl.trim() || !draft.geo || !draft.creativeName || !draft.groupIds.length}
                    >
                        У чергу
                    </button>
                </div>
            </form>
        </div>
    );
}


function CampaignAccountModal({
    accountKey, initialAccounts, onClose, onSelect, onError,
}) {
    const [accounts, setAccounts] = useState(initialAccounts ?? []);
    const [selectedId, setSelectedId] = useState("");
    const [loading, setLoading] = useState(false);
    const load = async () => {
        setLoading(true);
        try {
            setAccounts(await unwrap(window.adsBot.getAdAccounts(accountKey)));
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося оновити рекламні акаунти",
            });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        load();
    }, [accountKey]);
    const selected = accounts.find((account) => account.id === selectedId);

    return (
        <div className="overlay" onMouseDown={onClose}>
            <div
                className="modal campaign-account-modal"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">Створення кампанії</span>
                <h2>Оберіть рекламний акаунт</h2>
                <p>Пошук працює лише за ID. Активні акаунти завжди показані першими.</p>
                <label className="field">
                    <span>Рекламний акаунт</span>
                    <div className="resource-select-row">
                        <AdAccountSelect
                            accounts={accounts}
                            value={selectedId}
                            onChange={setSelectedId}
                            disabled={loading}
                        />
                        <button
                            type="button"
                            className="icon-button resource-refresh-button"
                            title="Оновити рекламні акаунти"
                            disabled={loading}
                            onClick={load}
                        >
                            <RefreshCw className={loading ? "spin" : ""} size={17} />
                        </button>
                    </div>
                </label>
                <div className="account-status-legend">
                    <span><i className="status-dot active" />Активний</span>
                    <span><i className="status-dot inactive" />Неактивний</span>
                </div>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        type="button"
                        className="primary-button"
                        disabled={!selected || selected.status !== "active"}
                        onClick={() => onSelect(selected)}
                    >
                        Продовжити
                    </button>
                </div>
            </div>
        </div>
    );
}


export default function PagesTab({
    selectedAccount,
    pages,
    adAccounts,
    groups,
    selectedPageId,
    setSelectedPageId,
    onPagesChange,
    onRefresh,
    settings,
    onError,
    showToast,
}) {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [listRefreshing, setListRefreshing] = useState(false);
    const [selectedRefreshing, setSelectedRefreshing] = useState(false);
    const [postsChanged, setPostsChanged] = useState(false);
    const [action, setAction] = useState(null);
    const [countries, setCountries] = useState([]);
    const postsByPage = useRef({});
    const postsRequestId = useRef(0);
    const signatureRequestId = useRef(0);
    const accountKey = selectedAccount?.accountKey || "";
    const selected = pages.find((page) => String(page.id) === String(selectedPageId));
    const favorites = useMemo(() => pages
        .filter((page) => page.isFavorite)
        .sort((left, right) => (
            (left.geo || "ZZZ").localeCompare(right.geo || "ZZZ")
            || compare(left, right)
        )), [pages]);
    const others = useMemo(() => pages
        .filter((page) => !page.isFavorite)
        .sort(compare), [pages]);

    const loadPosts = async (force = false) => {
        if (!selected) return;
        const pageId = String(selected.id);
        const requestId = ++postsRequestId.current;
        setLoading(true);
        try {
            const next = await unwrap(window.adsBot.getPagePostsWithLinks(
                accountKey,
                pageId,
                force
            ));
            postsByPage.current[`${accountKey}::${pageId}`] = next;
            if (requestId === postsRequestId.current) setPosts(next);
            return next;
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити пости",
            });
        } finally {
            if (requestId === postsRequestId.current) setLoading(false);
        }
        return null;
    };

    const checkPostChanges = async (pageId, knownPosts) => {
        const requestId = ++signatureRequestId.current;
        try {
            const signature = await unwrap(
                window.adsBot.getPagePostsSignature(accountKey, pageId)
            );
            if (requestId !== signatureRequestId.current) return;
            const knownIds = (knownPosts ?? []).map((post) => String(post.id));
            const remoteIds = (signature.postIds ?? []).map(String);
            setPostsChanged(
                signature.count !== knownIds.length
                || remoteIds.some((id, index) => id !== knownIds[index])
            );
        } catch (error) {
            window.adsBot.writeRendererLog?.({
                level: "debug",
                event: "pages.posts-signature.failed",
                message: error.message,
            })?.catch(() => {});
        }
    };

    useEffect(() => {
        unwrap(window.adsBot.getCountries()).then(setCountries).catch(() => {});
    }, []);
    useEffect(() => {
        postsRequestId.current += 1;
        signatureRequestId.current += 1;
        setPostsChanged(false);
        const key = `${accountKey}::${selected?.id ?? ""}`;
        setPosts(postsByPage.current[key] ?? []);
        if (selected) {
            const pageId = String(selected.id);
            loadPosts().then((knownPosts) => {
                if (knownPosts) checkPostChanges(pageId, knownPosts);
            });
        }
    }, [selected?.id, accountKey]);
    useEffect(() => {
        const unsubscribe = window.adsBot.onPagePostsCacheUpdated?.((event) => {
            if (!event?.accountKey || !event?.pageId) return;
            const key = `${event.accountKey}::${event.pageId}`;
            const current = postsByPage.current[key] ?? [];
            const removed = new Set((
                event.postIds ?? event.removedPostIds ?? []
            ).map(String));
            let next = current.filter((post) => !removed.has(String(post.id)));
            if (event.type === "clear") next = [];
            if (event.post) {
                next = [event.post, ...next.filter((post) => (
                    String(post.id) !== String(event.post.id)
                ))].slice(0, 10);
            }
            postsByPage.current[key] = next;
            if (
                event.accountKey === accountKey
                && String(event.pageId) === String(selectedPageId)
            ) setPosts(next);
        }) ?? (() => {});
        return unsubscribe;
    }, [accountKey, selectedPageId]);

    const refreshFanpageList = async () => {
        setListRefreshing(true);
        try {
            await onRefresh?.();
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося оновити список фанок",
            });
        } finally {
            setListRefreshing(false);
        }
    };

    const refreshSelectedFanpage = async () => {
        if (!selected || selectedRefreshing) return;
        const pageId = String(selected.id);
        setSelectedRefreshing(true);
        try {
            const result = await unwrap(window.adsBot.refreshSelectedFanPage(
                accountKey,
                pageId
            ));
            const key = `${accountKey}::${pageId}`;
            postsByPage.current[key] = result.posts;
            setPosts(result.posts);
            setPostsChanged(false);
            onPagesChange(pages.map((page) => (
                String(page.id) === pageId
                    ? { ...page, ...result.page }
                    : page
            )));
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося оновити фанку",
            });
        } finally {
            setSelectedRefreshing(false);
        }
    };

    const favorite = async (page, isFavorite) => {
        const preference = await unwrap(
            window.adsBot.setPageFavorite(page.id, isFavorite)
        );
        onPagesChange(pages.map((item) => (
            String(item.id) === String(page.id)
                ? { ...item, ...preference }
                : item
        )));
    };
    const metadata = async (patch) => {
        const value = await unwrap(
            window.adsBot.updatePageMetadata(selected.id, patch)
        );
        onPagesChange(pages.map((item) => (
            String(item.id) === String(selected.id)
                ? { ...item, ...value }
                : item
        )));
    };
    const updateSelectedLocally = (patch) => onPagesChange(pages.map((item) => (
        String(item.id) === String(selected.id) ? { ...item, ...patch } : item
    )));
    const queued = (message) => {
        setAction(null);
        showToast(message, "success");
    };

    let lastGeo = null;
    return (
        <section className="page-workspace">
            {!selectedAccount && (
                <div className="empty-state">
                    <h2>Оберіть API-клієнта</h2>
                    <p>Це можна зробити у першій вкладці.</p>
                </div>
            )}
            {selectedAccount && (
                <div className="ad-layout">
                    <aside className="ad-account-column">
                        <div className="ad-list-header">
                            <div>
                                <span className="eyebrow">Facebook</span>
                                <h2>Фанпейджі</h2>
                            </div>
                            <button className="icon-button" title="Оновити список фанок" aria-label="Оновити список фанок" onClick={refreshFanpageList} disabled={listRefreshing}>
                                <RefreshCw className={listRefreshing ? "spin" : ""} size={17} />
                            </button>
                        </div>
                        <div className="ad-account-scroll">
                            <div className="ad-section-title">
                                <strong>Обрані</strong><span>{favorites.length}</span>
                            </div>
                            {favorites.map((page) => {
                                const divider = lastGeo !== null
                                    && lastGeo !== (page.geo || "");
                                lastGeo = page.geo || "";
                                return (
                                    <div key={page.id} className={divider ? "page-geo-divider" : ""}>
                                        <PageCard
                                            page={page}
                                            selected={String(page.id) === String(selectedPageId)}
                                            onSelect={setSelectedPageId}
                                            onFavorite={favorite}
                                        />
                                    </div>
                                );
                            })}
                            <div className="ad-section-title secondary">
                                <strong>Інші</strong><span>{others.length}</span>
                            </div>
                            {others.map((page) => (
                                <PageCard
                                    key={page.id}
                                    page={page}
                                    selected={String(page.id) === String(selectedPageId)}
                                    onSelect={setSelectedPageId}
                                    onFavorite={favorite}
                                />
                            ))}
                        </div>
                    </aside>

                    <div className="ad-details">
                        {!selected ? (
                            <div className="empty-state"><h2>Оберіть фанпейджу</h2></div>
                        ) : (
                            <>
                                <header className="page-details-header">
                                    <div>
                                        <span className="eyebrow">Fanpage workspace</span>
                                        <h1>{selected.name}</h1>
                                        <div className="page-post-status">
                                            <span>URL-постів серед останніх 10: {posts.length}</span>
                                            {postsChanged && <strong>У Facebook є зміни</strong>}
                                        </div>
                                    </div>
                                    <div className="page-details-header-actions">
                                        <button
                                            className="icon-button"
                                            title="Оновити вибрану фанку і пости"
                                            aria-label="Оновити вибрану фанку і пости"
                                            disabled={selectedRefreshing}
                                            onClick={refreshSelectedFanpage}
                                        >
                                            <RefreshCw className={selectedRefreshing ? "spin" : ""} size={18} />
                                        </button>
                                        <button
                                            className="primary-button"
                                            onClick={() => setAction({ type: "launch" })}
                                        >
                                            <Rocket size={18} />Запустити новий креатив
                                        </button>
                                    </div>
                                </header>

                                <div className="page-metadata-grid">
                                    <label className="field">
                                        <span>GEO</span>
                                        <GeoSelect
                                            countries={countries}
                                            value={selected.geo || ""}
                                            onChange={(geo) => {
                                                updateSelectedLocally({ geo });
                                                metadata({ geo }).catch((error) => onError(errorDetails(error)));
                                            }}
                                        />
                                    </label>
                                    <label className="field">
                                        <span>Запущений креатив</span>
                                        <div className="inline-field">
                                            <input
                                                value={selected.creativeName || ""}
                                                placeholder="Empty"
                                                onChange={(event) => updateSelectedLocally({
                                                    creativeName: event.target.value.replace(/^Creo_/i, ""),
                                                })}
                                                onBlur={(event) => metadata({
                                                    creativeName: event.target.value,
                                                })}
                                            />
                                            <Pencil size={15} />
                                        </div>
                                        <small>{marker(selected.creativeName)}</small>
                                    </label>
                                    <div>
                                        <span>Meta-назва</span>
                                        <strong>{selected.name}</strong>
                                        <CopyButton value={selected.name} label="Meta-назву" />
                                    </div>
                                    <div>
                                        <span>Page ID</span>
                                        <strong>{selected.id}</strong>
                                        <span className="metadata-actions">
                                            <CopyButton value={selected.id} label="Page ID" />
                                            <button
                                                className="icon-button"
                                                title="Відкрити у Facebook"
                                                onClick={() => window.adsBot.openExternal(
                                                    `https://www.facebook.com/${selected.id}`
                                                )}
                                            >
                                                <ExternalLink size={14} />
                                            </button>
                                        </span>
                                    </div>
                                    <div className="page-link-field">
                                        <span>Посилання на фанку</span>
                                        <strong>{`facebook.com/${selected.id}`}</strong>
                                        <span className="metadata-actions">
                                            <CopyButton
                                                value={`https://www.facebook.com/${selected.id}`}
                                                label="посилання на фанку"
                                            />
                                            <button
                                                className="icon-button"
                                                title="Відкрити фанку у Facebook"
                                                onClick={() => window.adsBot.openExternal(
                                                    `https://www.facebook.com/${selected.id}`
                                                )}
                                            >
                                                <ExternalLink size={14} />
                                            </button>
                                        </span>
                                    </div>
                                </div>

                                <div className="page-actions">
                                    <button
                                        className="secondary-button"
                                        onClick={() => setAction({
                                            type: "comment-manual",
                                            commentTarget: "post",
                                        })}
                                    >
                                        <MessageSquareText size={16} />Закоментити пост
                                    </button>
                                    <button
                                        className="secondary-button"
                                        onClick={() => setAction({
                                            type: "comment-manual",
                                            commentTarget: "ad",
                                        })}
                                    >
                                        <Megaphone size={16} />Закоментити рекламну об’яву
                                    </button>
                                    <button
                                        className="secondary-button"
                                        onClick={() => setAction({ type: "publish" })}
                                    >
                                        <Send size={16} />Запостити креатив
                                    </button>
                                    <button
                                        className="danger-button"
                                        onClick={async () => {
                                            if (!window.confirm("Видалити URL-пости серед 10 найновіших?")) return;
                                            await unwrap(window.adsBot.deletePagePosts({
                                                accountKey,
                                                pageId: selected.id,
                                            }));
                                            queued("Видалення поставлено в чергу");
                                        }}
                                    >
                                        <Trash2 size={16} />Видалити URL-пости
                                    </button>
                                    <button
                                        className="danger-button page-rebuild-action"
                                        title="Пересетапити фанпейдж"
                                        onClick={() => setAction({
                                            type: "rebuild",
                                            page: selected,
                                        })}
                                    >
                                        <RotateCcw size={16} />Пересетапити
                                    </button>
                                </div>

                                <div className="page-post-list">
                                    {loading && <LoaderCircle className="spin" />}
                                    {!loading && !posts.length && (
                                        <div className="empty-state compact">
                                            Серед 10 найновіших немає постів із посиланням.
                                        </div>
                                    )}
                                    {posts.map((post) => (
                                        <article className="page-post-card" key={post.id}>
                                            <StableImage
                                                src={post.thumbnailUrl}
                                                alt="Прев’ю поста"
                                                fallback={<div className="post-thumb-placeholder" />}
                                            />
                                            <div>
                                                <strong>{new Date(post.createdTime).toLocaleString("uk-UA")}</strong>
                                                <p>{post.message}</p>
                                                <div className="page-post-reference">
                                                    <small>ID: {post.id}</small>
                                                    {post.permalinkUrl && (
                                                        <>
                                                            <span>{post.permalinkUrl}</span>
                                                            <CopyButton
                                                                value={post.permalinkUrl}
                                                                label="посилання на пост"
                                                            />
                                                            <button
                                                                type="button"
                                                                className="page-copy-button"
                                                                title="Відкрити пост у Facebook"
                                                                onClick={() => window.adsBot.openExternal(
                                                                    post.permalinkUrl
                                                                )}
                                                            >
                                                                <ExternalLink size={14} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                                <div className="post-actions">
                                                    <button onClick={async () => {
                                                        if (!window.confirm("Видалити цей пост?")) return;
                                                        await unwrap(window.adsBot.deletePagePost({
                                                            accountKey,
                                                            pageId: selected.id,
                                                            postId: post.id,
                                                        }));
                                                        queued("Видалення поставлено в чергу");
                                                    }}>
                                                        <Trash2 size={14} />Видалити
                                                    </button>
                                                    <button onClick={() => setAction({ type: "comment", post })}>
                                                        <MessageSquareText size={14} />Закоментити
                                                    </button>
                                                    <button onClick={() => setAction({ type: "campaign-select", post })}>
                                                        <Megaphone size={14} />Кампанія
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {action?.type === "launch" && (
                <CreativeLaunchModal
                    accountKey={accountKey}
                    page={selected}
                    adAccounts={adAccounts}
                    groups={groups}
                    settings={settings}
                    onClose={() => setAction(null)}
                    onQueued={() => queued("Великий запуск поставлено в чергу")}
                    onError={onError}
                />
            )}
            {action?.type === "rebuild" && (
                <PageRebuildModal
                    page={action.page}
                    accountKey={accountKey}
                    onClose={() => setAction(null)}
                    onQueued={() => queued(
                        "Пересетаплення фанпейджа поставлено в чергу"
                    )}
                    onError={onError}
                />
            )}
            {action?.type === "publish" && (
                <PublicationModal
                    page={selected}
                    accountKey={accountKey}
                    countries={countries}
                    groups={groups}
                    settings={settings}
                    onClose={() => setAction(null)}
                    onQueued={() => queued("Публікацію поставлено в чергу")}
                    onError={onError}
                />
            )}
            {action?.type === "comment" && (
                <CommentModal
                    page={selected}
                    post={action.post}
                    accountKey={accountKey}
                    countries={countries}
                    groups={groups}
                    settings={settings}
                    onClose={() => setAction(null)}
                    onQueued={() => queued("Коментування поставлено в чергу")}
                    onError={onError}
                />
            )}
            {action?.type === "comment-manual" && (
                <CommentModal
                    page={selected}
                    commentTarget={action.commentTarget}
                    accountKey={accountKey}
                    countries={countries}
                    groups={groups}
                    settings={settings}
                    onClose={() => setAction(null)}
                    onQueued={() => queued("Коментування поставлено в чергу")}
                    onError={onError}
                />
            )}
            {action?.type === "campaign-select" && (
                <CampaignAccountModal
                    accountKey={accountKey}
                    initialAccounts={adAccounts}
                    onClose={() => setAction(null)}
                    onError={onError}
                    onSelect={(adAccount) => setAction({
                        ...action,
                        type: "campaign",
                        adAccount,
                    })}
                />
            )}
            {action?.type === "campaign" && (
                <CampaignCreationWizard
                    accountKey={accountKey}
                    adAccount={action.adAccount}
                    createPaused={settings.createCampaignsPaused}
                    createAdSetsPaused={settings.createAdSetsPaused}
                    createAdsPaused={settings.createAdsPaused}
                    defaultPixelId={settings.defaultPixelId}
                    defaultUtm={settings.defaultUtm}
                    initialPageId={selected.id}
                    initialPostId={action.post.id}
                    lastPublishedPost={{
                        pageId: selected.id,
                        postId: action.post.id,
                    }}
                    sourcePage={selected}
                    sourcePost={action.post}
                    onClose={() => setAction(null)}
                    onSuccess={() => queued("Кампанію поставлено в чергу")}
                />
            )}
        </section>
    );
}
