import { useEffect, useMemo, useState } from "react";
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
import ImageDropzone from "../components/ImageDropzone.jsx";
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


function PageCard({ page, selected, onSelect, onFavorite, onRebuild }) {
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
            <div className="page-card-heading">
                <strong>{page.geo || "—"}</strong>
                <b>{marker(page.creativeName)}</b>
            </div>
            <div className="page-card-body">
                <span className="page-avatar">
                    {String(page.name || "P").slice(0, 1).toUpperCase()}
                </span>
                <span className="page-card-copy">
                    <span className="page-card-value">
                        <strong>{page.name}</strong>
                        <CopyButton value={page.name} label="назву фанпейджі" />
                    </span>
                    <span className="page-card-value page-card-id">
                        <small>{page.id}</small>
                        <CopyButton value={page.id} label="ID фанпейджі" />
                    </span>
                </span>
                <button
                    type="button"
                    className="page-card-rebuild"
                    title="Пересетапити фанпейдж"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRebuild(page);
                    }}
                >
                    <RotateCcw size={14} />
                    Пересетапити
                </button>
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
    const [imagesDirectory, setImagesDirectory] = useState("");
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

    const chooseFolder = async () => {
        try {
            const selected = await unwrap(
                window.adsBot.selectPageRebuildFolder()
            );
            if (selected) setImagesDirectory(selected);
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
                imagesDirectory,
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
        && imagesDirectory
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
                            value={imagesDirectory}
                            placeholder="Папку не вибрано"
                        />
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={chooseFolder}
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
    page, accountKey, countries, onClose, onQueued, onError,
}) {
    const [draft, setDraft] = useState({
        geo: page.geo || "",
        creativeName: page.creativeName || "",
        siteUrl: "",
        imagePath: "",
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
                    <ImageDropzone
                        value={draft.imagePath}
                        onChange={(imagePath) => setDraft((current) => ({
                            ...current,
                            imagePath,
                        }))}
                        disabled={saving}
                    />
                </label>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        className="primary-button"
                        disabled={saving || !draft.geo || !draft.creativeName || !draft.siteUrl}
                    >
                        Опублікувати
                    </button>
                </div>
            </form>
        </div>
    );
}


function CommentModal({
    page, post, accountKey, countries, groups, settings, onClose, onQueued, onError,
}) {
    const defaultGroup = findGroupForGeo(groups, page.geo);
    const [draft, setDraft] = useState({
        geo: page.geo || "",
        creativeName: page.creativeName || "",
        siteUrl: "",
        groupIds: defaultGroup ? [String(defaultGroup.groupId)] : [],
    });
    const submit = async (event) => {
        event.preventDefault();
        try {
            onQueued(await unwrap(window.adsBot.runCommentingCampaign({
                ...draft,
                accountKey,
                postUrl: post.permalinkUrl,
                browserMode: settings.commentBrowserMode,
                disableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
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
                <span className="eyebrow">Пост {post.id}</span>
                <h2>Закоментити пост</h2>
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
                    <span>Offer URL (необов’язково)</span>
                    <input
                        value={draft.siteUrl}
                        onChange={(event) => setDraft((current) => ({
                            ...current,
                            siteUrl: event.target.value,
                        }))}
                    />
                </label>
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
                        disabled={!draft.geo || !draft.creativeName || !draft.groupIds.length}
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
    const [action, setAction] = useState(null);
    const [countries, setCountries] = useState([]);
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

    const loadPosts = async () => {
        if (!selected) return;
        setLoading(true);
        try {
            setPosts(await unwrap(
                window.adsBot.getPagePostsWithLinks(accountKey, selected.id)
            ));
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити пости",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        unwrap(window.adsBot.getCountries()).then(setCountries).catch(() => {});
    }, []);
    useEffect(() => {
        setPosts([]);
        if (selected) loadPosts();
    }, [selected?.id, accountKey]);

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
                            <button className="icon-button" onClick={onRefresh}>
                                <RefreshCw size={17} />
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
                                            onRebuild={(page) => setAction({
                                                type: "rebuild",
                                                page,
                                            })}
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
                                    onRebuild={(page) => setAction({
                                        type: "rebuild",
                                        page,
                                    })}
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
                                    </div>
                                    <button
                                        className="primary-button"
                                        onClick={() => setAction({ type: "launch" })}
                                    >
                                        <Rocket size={18} />Запустити новий креатив
                                    </button>
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
                                </div>

                                <div className="page-actions">
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
                                    <button className="icon-button" onClick={loadPosts}>
                                        <RefreshCw className={loading ? "spin" : ""} size={16} />
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
                                            {post.thumbnailUrl
                                                ? <img src={post.thumbnailUrl} alt="Прев’ю поста" />
                                                : <div className="post-thumb-placeholder" />}
                                            <div>
                                                <strong>{new Date(post.createdTime).toLocaleString("uk-UA")}</strong>
                                                <p>{post.message}</p>
                                                <small>{post.id}</small>
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
