import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, RefreshCw, X } from "lucide-react";

import AdAccountSelect from "./AdAccountSelect.jsx";
import GeoSelect from "./GeoSelect.jsx";
import ImageDropzone from "./ImageDropzone.jsx";
import MultiSelect from "./MultiSelect.jsx";
import SearchSelect from "./SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";
import { findGroupForGeo } from "../lib/groups.js";


const nowLocal = () => {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
};


export default function CreativeLaunchModal({
    accountKey, page, adAccounts, groups, settings, onClose, onQueued, onError,
}) {
    const [templates, setTemplates] = useState([]);
    const [countries, setCountries] = useState([]);
    const [availableAdAccounts, setAvailableAdAccounts] = useState(adAccounts ?? []);
    const [accountsLoading, setAccountsLoading] = useState(false);
    const [pixels, setPixels] = useState([]);
    const [pixelsLoading, setPixelsLoading] = useState(false);
    const [manualName, setManualName] = useState(false);
    const [overrideTracking, setOverrideTracking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState({
        geo: page.geo || "",
        creativeName: page.creativeName || "",
        siteUrl: "",
        imagePath: "",
        deleteOldPosts: true,
        groupIds: [],
        templateId: "",
        adAccountId: "",
        pixelId: settings.defaultPixelId || "",
        utm: settings.defaultUtm || "",
        campaignName: "",
        startTime: nowLocal(),
        adSetCount: 5,
        dailyBudget: 5,
    });

    const reportLoadError = (error, title) => onError({
        ...errorDetails(error),
        title,
    });
    const loadAdAccounts = async () => {
        setAccountsLoading(true);
        try {
            setAvailableAdAccounts(await unwrap(window.adsBot.getAdAccounts(accountKey)));
        } catch (error) {
            reportLoadError(error, "Не вдалося оновити рекламні акаунти");
        } finally {
            setAccountsLoading(false);
        }
    };

    useEffect(() => {
        Promise.all([
            unwrap(window.adsBot.getTemplates()),
            unwrap(window.adsBot.getCountries()),
        ]).then(([nextTemplates, nextCountries]) => {
            const sortedTemplates = nextTemplates.slice().sort((left, right) => (
                String(left.name).localeCompare(String(right.name), "uk-UA", {
                    numeric: true,
                    sensitivity: "base",
                })
            ));
            setTemplates(sortedTemplates);
            setCountries(nextCountries);
            setDraft((current) => ({
                ...current,
                templateId: String(sortedTemplates[0]?.id || ""),
            }));
        }).catch((error) => reportLoadError(error, "Не вдалося завантажити форму запуску"));
        loadAdAccounts();
    }, [accountKey]);

    useEffect(() => {
        if (!draft.geo || draft.groupIds.length) return;
        const match = findGroupForGeo(groups, draft.geo);
        if (match) {
            setDraft((current) => ({
                ...current,
                groupIds: [String(match.groupId)],
            }));
        }
    }, [draft.geo, groups]);

    const selectedTemplate = templates.find(
        (item) => String(item.id) === draft.templateId
    );
    const selectedAdAccount = availableAdAccounts.find(
        (item) => String(item.id) === draft.adAccountId
    );
    const automaticName = `${draft.geo || "GEO"} | Creo_${draft.creativeName || "?"} | ${selectedTemplate?.ageMin ?? 18}+`;

    useEffect(() => {
        if (!manualName) {
            setDraft((current) => ({ ...current, campaignName: automaticName }));
        }
    }, [automaticName, manualName]);

    const loadPixels = async () => {
        if (!draft.adAccountId) return;
        setPixelsLoading(true);
        try {
            setPixels(await unwrap(
                window.adsBot.getAdPixels(accountKey, draft.adAccountId)
            ));
        } catch (error) {
            reportLoadError(error, "Не вдалося завантажити Pixel");
        } finally {
            setPixelsLoading(false);
        }
    };

    useEffect(() => {
        if (overrideTracking) loadPixels();
    }, [draft.adAccountId, overrideTracking]);

    const update = (field, value) => setDraft((current) => ({
        ...current,
        [field]: value,
    }));
    const canSubmit = draft.geo
        && draft.creativeName
        && draft.siteUrl
        && draft.templateId
        && selectedAdAccount?.status === "active"
        && draft.pixelId
        && draft.groupIds.length
        && draft.campaignName;
    const submit = async (event) => {
        event.preventDefault();
        if (!canSubmit || saving) return;
        setSaving(true);
        try {
            const result = await unwrap(window.adsBot.startCreativeLaunch({
                ...draft,
                accountKey,
                pageId: String(page.id),
                templateId: Number(draft.templateId),
                startTime: new Date(draft.startTime).toISOString(),
                adSetCount: Number(draft.adSetCount),
                dailyBudget: Number(draft.dailyBudget),
                campaignNameManual: manualName,
                createPaused: settings.createCampaignsPaused,
                browserMode: settings.commentBrowserMode,
                disableImages: settings.commentDisableImages,
                commentWorkerConcurrency: settings.commentWorkerConcurrency,
            }));
            onQueued(result);
        } catch (error) {
            reportLoadError(error, "Не вдалося поставити запуск у чергу");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overlay creative-launch-overlay" onMouseDown={() => !saving && onClose()}>
            <form
                className="modal creative-launch-modal"
                onSubmit={submit}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={18} />
                </button>

                <header className="creative-launch-header">
                    <span className="eyebrow">Запустити новий креатив</span>
                    <div className={`campaign-title-editor ${manualName ? "editing" : ""}`}>
                        {manualName ? (
                            <input
                                autoFocus
                                aria-label="Назва кампанії"
                                value={draft.campaignName}
                                onChange={(event) => update("campaignName", event.target.value)}
                            />
                        ) : (
                            <h2>{draft.campaignName || automaticName}</h2>
                        )}
                        {!manualName && (
                            <button type="button" title="Змінити назву" onClick={() => setManualName(true)}>
                                <Pencil size={17} />
                            </button>
                        )}
                        {manualName && (
                            <button
                                type="button"
                                title="Повернути автоматичну назву"
                                onClick={() => {
                                    setManualName(false);
                                    update("campaignName", automaticName);
                                }}
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                    <label className="checkbox-line launch-delete-posts">
                        <input
                            type="checkbox"
                            checked={draft.deleteOldPosts}
                            onChange={(event) => update("deleteOldPosts", event.target.checked)}
                        />
                        <span>Видалити URL-пости серед 10 найновіших</span>
                    </label>
                </header>

                <div className="creative-launch-scroll">
                    <section className="launch-section">
                        <header><strong>Креатив</strong></header>
                        <div className="creative-fields-row">
                            <label className="field geo-field">
                                <span>GEO</span>
                                <GeoSelect
                                    countries={countries}
                                    value={draft.geo}
                                    onChange={(value) => update("geo", value)}
                                />
                            </label>
                            <label className="field">
                                <span>Назва креативу</span>
                                <input
                                    value={draft.creativeName}
                                    onChange={(event) => update(
                                        "creativeName",
                                        event.target.value.replace(/^Creo_/i, "")
                                    )}
                                    placeholder="1 або 138V2"
                                />
                            </label>
                        </div>
                        <label className="field">
                            <span>Посилання на офер</span>
                            <input
                                type="url"
                                value={draft.siteUrl}
                                onChange={(event) => update("siteUrl", event.target.value)}
                                placeholder="https://…"
                            />
                        </label>
                        <label className="field">
                            <span>Зображення</span>
                            <ImageDropzone
                                value={draft.imagePath}
                                onChange={(value) => update("imagePath", value)}
                                disabled={saving}
                            />
                        </label>
                    </section>

                    <section className="launch-section">
                        <header>
                            <strong>Акаунти для коментарів</strong>
                            <small>Автовибір за GEO фанпейджі</small>
                        </header>
                        <MultiSelect
                            items={groups}
                            value={draft.groupIds}
                            onChange={(value) => update("groupIds", value)}
                        />
                    </section>

                    <section className="launch-section campaign-launch-section">
                        <header><strong>Рекламна кампанія</strong></header>
                        <label className="field">
                            <span>Рекламний акаунт · пошук за ID</span>
                            <div className="resource-select-row">
                                <AdAccountSelect
                                    accounts={availableAdAccounts}
                                    value={draft.adAccountId}
                                    onChange={(value) => update("adAccountId", value)}
                                    disabled={accountsLoading}
                                />
                                <button
                                    type="button"
                                    className="icon-button resource-refresh-button"
                                    title="Оновити рекламні акаунти"
                                    disabled={accountsLoading}
                                    onClick={loadAdAccounts}
                                >
                                    <RefreshCw className={accountsLoading ? "spin" : ""} size={17} />
                                </button>
                            </div>
                        </label>

                        <label className="field">
                            <span>Шаблон</span>
                            <SearchSelect
                                items={templates}
                                value={draft.templateId}
                                onChange={(value) => update("templateId", String(value))}
                                getId={(template) => String(template.id)}
                                getTitle={(template) => template.name}
                                getSubtitle={(template) => `ID ${template.id}`}
                                placeholder="Оберіть шаблон"
                                searchPlaceholder="Пошук шаблону за назвою…"
                                ariaLabel="Шаблон"
                            />
                        </label>

                        <label className="checkbox-line tracking-toggle">
                            <input
                                type="checkbox"
                                checked={overrideTracking}
                                onChange={(event) => {
                                    setOverrideTracking(event.target.checked);
                                    if (!event.target.checked) {
                                        setDraft((current) => ({
                                            ...current,
                                            pixelId: settings.defaultPixelId || "",
                                            utm: settings.defaultUtm || "",
                                        }));
                                    }
                                }}
                            />
                            <span>Ввести Pixel і UTM вручну</span>
                        </label>

                        {overrideTracking && (
                            <div className="tracking-editor">
                                <label className="field">
                                    <span>Pixel · пошук за назвою або ID</span>
                                    <div className="resource-select-row">
                                        <SearchSelect
                                            items={pixels}
                                            value={draft.pixelId}
                                            onChange={(value) => update("pixelId", String(value))}
                                            getId={(pixel) => String(pixel.id)}
                                            getTitle={(pixel) => pixel.name || pixel.id}
                                            getSubtitle={(pixel) => pixel.id}
                                            placeholder="Оберіть Pixel"
                                            searchPlaceholder="Назва або ID Pixel…"
                                            disabled={!draft.adAccountId || pixelsLoading}
                                            ariaLabel="Pixel"
                                        />
                                        <button
                                            type="button"
                                            className="icon-button resource-refresh-button"
                                            onClick={loadPixels}
                                            disabled={!draft.adAccountId || pixelsLoading}
                                        >
                                            <RefreshCw className={pixelsLoading ? "spin" : ""} size={17} />
                                        </button>
                                    </div>
                                </label>
                                <label className="field">
                                    <span>UTM</span>
                                    <textarea
                                        rows="3"
                                        value={draft.utm}
                                        onChange={(event) => update("utm", event.target.value)}
                                    />
                                </label>
                            </div>
                        )}

                        <label className="field launch-start-field">
                            <span>
                                Старт
                                <b>{selectedAdAccount?.timezoneName || "Часовий пояс РК"}</b>
                            </span>
                            <input
                                type="datetime-local"
                                step="60"
                                value={draft.startTime}
                                onChange={(event) => update("startTime", event.target.value)}
                            />
                        </label>
                        <div className="launch-budget-grid">
                            <label className="field">
                                <span>Ad sets</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={draft.adSetCount}
                                    onChange={(event) => update("adSetCount", event.target.value)}
                                />
                            </label>
                            <label className="field">
                                <span>Бюджет / ad set</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft.dailyBudget}
                                    onChange={(event) => update("dailyBudget", event.target.value)}
                                />
                            </label>
                        </div>
                    </section>
                </div>

                <div className="form-actions creative-launch-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button className="primary-button" disabled={!canSubmit || saving}>
                        {saving && <LoaderCircle className="spin" size={16} />}
                        Поставити в чергу
                    </button>
                </div>
            </form>
        </div>
    );
}
