import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    Bot,
    ChevronDown,
    ListChecks,
    MessageSquare,
    MessageSquareText,
    Minus,
    Plus,
    RotateCcw,
    Settings,
    SlidersHorizontal,
    WalletCards,
    X,
    ZoomIn,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";

import WorkerProxyPicker from "./WorkerProxyPicker.jsx";
import KeitaroCampaignSettings from "./KeitaroCampaignSettings.jsx";
import SpendSettings from "./SpendSettings.jsx";


const minimumScale = 80;
const maximumScale = 150;
const scaleStep = 10;


export default function SettingsModal({
    scale,
    onScaleChange,
    createCampaignsPaused,
    onCreateCampaignsPausedChange,
    createAdSetsPaused = true,
    onCreateAdSetsPausedChange = () => {},
    createAdsPaused = true,
    onCreateAdsPausedChange = () => {},
    commentWorkerConcurrency,
    onCommentWorkerConcurrencyChange,
    commentWorkerProxyIds = {},
    onCommentWorkerProxyIdsChange = () => {},
    defaultPixelId,
    onDefaultPixelIdChange,
    defaultUtm,
    onDefaultUtmChange,
    commentBrowserMode,
    onCommentBrowserModeChange,
    commentDisableImages,
    onCommentDisableImagesChange,
    accountSetupWorkerConcurrency = 5,
    onAccountSetupWorkerConcurrencyChange = () => {},
    accountSetupWorkerProxyIds = {},
    onAccountSetupWorkerProxyIdsChange = () => {},
    accountSetupBrowserMode = "visible",
    onAccountSetupBrowserModeChange = () => {},
    apiClientsBrowserMode = "visible",
    onApiClientsBrowserModeChange = () => {},
    apiClientsDisableImages = false,
    onApiClientsDisableImagesChange = () => {},
    logLevel,
    onLogLevelChange,
    proxies = [],
    proxiesLoading = false,
    onCreateProxy,
    onUpdateProxy,
    onDeleteProxy,
    onGetProxy,
    onCheckProxy,
    onCheckProxyConfig,
    onRefreshProxyIp,
    onError = () => {},
    showToast,
    keitaroAvailableGroupIds = [],
    onKeitaroAvailableGroupIdsChange = () => {},
    keitaroConcurrency = 20,
    onKeitaroConcurrencyChange = () => {},
    onClose,
}) {
    const [tab, setTab] = useState("general");
    const [pickerWorkerId, setPickerWorkerId] = useState(null);
    const [keitaroGroupsOpen, setKeitaroGroupsOpen] = useState(true);
    const [keitaroGroups, setKeitaroGroups] = useState([]);
    const [keitaroGroupsLoading, setKeitaroGroupsLoading] = useState(false);
    const settingsBodyRef = useRef(null);
    const percentage = Math.round(scale * 100);
    const change = (nextPercentage) => {
        const normalized = Math.min(
            maximumScale,
            Math.max(minimumScale, nextPercentage)
        );
        onScaleChange(normalized / 100);
    };
    useEffect(() => {
        settingsBodyRef.current?.scrollTo?.({ top: 0 });
    }, [tab]);
    useEffect(() => {
        if (tab !== "keitaro") return undefined;
        let cancelled = false;
        setKeitaroGroupsLoading(true);
        if (typeof window.adsBot?.getKeitaroCampaignGroups !== "function") {
            setKeitaroGroupsLoading(false);
            return undefined;
        }
        unwrap(window.adsBot.getKeitaroCampaignGroups())
            .then((groups) => {
                if (!cancelled) setKeitaroGroups(groups ?? []);
            })
            .catch((error) => {
                if (!cancelled) {
                    onError({
                        ...errorDetails(error),
                        title: "Не вдалося завантажити групи Keitaro",
                    });
                }
            })
            .finally(() => {
                if (!cancelled) setKeitaroGroupsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tab]);

    const setupPicker = tab === "account-setup";
    const activeProxyIds = setupPicker
        ? accountSetupWorkerProxyIds
        : commentWorkerProxyIds;
    const assignedIds = Object.entries(activeProxyIds)
        .filter(([workerId]) => Number(workerId) !== pickerWorkerId)
        .map(([, proxyId]) => proxyId);
    const assignProxy = (workerId, proxyId) => {
        const next = {
            ...activeProxyIds,
            [String(workerId)]: proxyId,
        };
        if (setupPicker) onAccountSetupWorkerProxyIdsChange(next);
        else onCommentWorkerProxyIdsChange(next);
    };
    const clearProxy = (workerId) => {
        const next = { ...activeProxyIds };
        delete next[String(workerId)];
        if (setupPicker) onAccountSetupWorkerProxyIdsChange(next);
        else onCommentWorkerProxyIdsChange(next);
    };

    return (
        <div className="overlay" onMouseDown={onClose}>
            <motion.div
                className="modal settings-modal"
                initial={{ opacity: 0, y: 20, scale: .97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <div className="settings-layout">
                    <nav className="settings-nav">
                        <div className="modal-icon settings-icon"><Settings /></div>
                        <span className="eyebrow">AdsBot preferences</span>
                        <h2>Налаштування</h2>
                        <button
                            type="button"
                            className={tab === "general" ? "active" : ""}
                            onClick={() => setTab("general")}
                        >
                            <SlidersHorizontal size={15} /> Загальні
                        </button>
                        <button
                            type="button"
                            className={tab === "comments" ? "active" : ""}
                            onClick={() => setTab("comments")}
                        >
                            <MessageSquareText size={15} /> Коментарі
                        </button>
                        <button
                            type="button"
                            className={tab === "account-setup" ? "active" : ""}
                            onClick={() => setTab("account-setup")}
                        >
                            <MessageSquare size={15} /> Акаунти
                        </button>
                        <button
                            type="button"
                            className={tab === "keitaro" ? "active" : ""}
                            onClick={() => setTab("keitaro")}
                        >
                            <ListChecks size={15} /> Keitaro
                        </button>
                        <button
                            type="button"
                            className={tab === "api-clients" ? "active" : ""}
                            onClick={() => setTab("api-clients")}
                        >
                            <Bot size={15} /> API-клієнти
                        </button>
                        <button
                            type="button"
                            className={tab === "spend" ? "active" : ""}
                            onClick={() => setTab("spend")}
                        >
                            <WalletCards size={15} /> Спенд
                        </button>
                    </nav>
                    <div className="settings-body" ref={settingsBodyRef}>
                        {tab === "general" && (
                            <>
                                <p>Зміни застосовуються одразу та зберігаються після закриття програми.</p>
                                <section className="scale-setting">
                                    <div className="scale-setting-heading">
                                        <span><ZoomIn size={15} /> Масштаб інтерфейсу</span>
                                        <strong>{percentage}%</strong>
                                    </div>
                                    <div className="scale-controls">
                                        <button
                                            className="icon-button"
                                            disabled={percentage <= minimumScale}
                                            onClick={() => change(percentage - scaleStep)}
                                        >
                                            <Minus size={15} />
                                        </button>
                                        <input
                                            aria-label="Масштаб інтерфейсу"
                                            type="range"
                                            min={minimumScale}
                                            max={maximumScale}
                                            step={scaleStep}
                                            value={percentage}
                                            onChange={(event) => change(Number(event.target.value))}
                                        />
                                        <button
                                            className="icon-button"
                                            disabled={percentage >= maximumScale}
                                            onClick={() => change(percentage + scaleStep)}
                                        >
                                            <Plus size={15} />
                                        </button>
                                    </div>
                                    <div className="scale-labels">
                                        <span>{minimumScale}%</span>
                                        <span>{maximumScale}%</span>
                                    </div>
                                </section>

                                <section className="scale-setting campaign-safety-setting">
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={createCampaignsPaused}
                                            onChange={(event) => onCreateCampaignsPausedChange(
                                                event.target.checked
                                            )}
                                        />
                                        <span>
                                            <strong>Залишати campaign на паузі</strong>
                                            <small>Новостворений campaign матиме статус PAUSED.</small>
                                        </span>
                                    </label>
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={createAdSetsPaused}
                                            onChange={(event) => onCreateAdSetsPausedChange(
                                                event.target.checked
                                            )}
                                        />
                                        <span>
                                            <strong>Залишати Ad Set на паузі</strong>
                                            <small>Новостворені набори реклами матимуть статус PAUSED.</small>
                                        </span>
                                    </label>
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={createAdsPaused}
                                            onChange={(event) => onCreateAdsPausedChange(
                                                event.target.checked
                                            )}
                                        />
                                        <span>
                                            <strong>Залишати оголошення на паузі</strong>
                                            <small>Новостворені рекламні оголошення матимуть статус PAUSED.</small>
                                        </span>
                                    </label>
                                </section>

                                <section className="scale-setting">
                                    <div className="scale-setting-heading"><span>Реклама за замовчуванням</span></div>
                                    <label className="field"><span>Pixel ID</span><input value={defaultPixelId} onChange={(event) => onDefaultPixelIdChange(event.target.value)} placeholder="Не вказано" /></label>
                                    <label className="field"><span>UTM / URL tags</span><textarea rows="3" value={defaultUtm} onChange={(event) => onDefaultUtmChange(event.target.value)} placeholder="utm_source={{site_source_name}}" /></label>
                                    <small className="settings-hint">Ці значення підставляються у нові кампанії, але їх можна перевизначити у формі запуску.</small>
                                </section>

                                <section className="scale-setting">
                                    <div className="scale-setting-heading"><span>Детальність журналу</span></div>
                                    <label className="field">
                                        <span>Рівень логування</span>
                                        <select aria-label="Рівень логування" value={logLevel} onChange={(event) => onLogLevelChange(event.target.value)}>
                                            <option value="info">Info — звичайний режим</option>
                                            <option value="debug">Debug — детальна діагностика</option>
                                        </select>
                                    </label>
                                    <small className="settings-hint">Debug створює більше технічних подій, але секрети однаково приховуються.</small>
                                </section>
                            </>
                        )}

                        {tab === "comments" && (
                            <>
                                <p>Воркер без проксі для коментування не використовується.</p>
                                <section className="scale-setting">
                                    <div className="scale-setting-heading">
                                        <span><ListChecks size={15} /> Браузери всередині коментування</span>
                                        <strong>{commentWorkerConcurrency}</strong>
                                    </div>
                                    <div className="scale-controls task-concurrency-controls">
                                        <button className="icon-button" disabled={commentWorkerConcurrency <= 1} onClick={() => onCommentWorkerConcurrencyChange(commentWorkerConcurrency - 1)}><Minus size={15} /></button>
                                        <input aria-label="Паралельні браузери коментування" type="range" min="1" max="5" step="1" value={commentWorkerConcurrency} onChange={(event) => onCommentWorkerConcurrencyChange(Number(event.target.value))} />
                                        <button className="icon-button" disabled={commentWorkerConcurrency >= 5} onClick={() => onCommentWorkerConcurrencyChange(commentWorkerConcurrency + 1)}><Plus size={15} /></button>
                                    </div>
                                    <div className="scale-labels"><span>1</span><span>5</span></div>
                                    <div className="comment-worker-grid">
                                        {Array.from({ length: commentWorkerConcurrency }, (_, index) => {
                                            const workerId = index + 1;
                                            const proxyId = commentWorkerProxyIds[String(workerId)];
                                            const proxy = proxies.find((item) => item.id === proxyId);
                                            return (
                                                <div className="comment-worker" key={workerId}>
                                                    <div className="comment-worker-id" aria-label={`Воркер ${workerId}`}>
                                                        {workerId}
                                                    </div>
                                                    {proxy ? (
                                                        <div className="comment-worker-proxy assigned">
                                                            <button
                                                                type="button"
                                                                title="Змінити проксі"
                                                                onClick={() => setPickerWorkerId(workerId)}
                                                            >
                                                                {proxy.name || proxy.id}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="icon-button"
                                                                title="Прибрати проксі"
                                                                onClick={() => clearProxy(workerId)}
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="comment-worker-proxy dashed"
                                                            aria-label={`Призначити проксі воркеру ${workerId}`}
                                                            onClick={() => setPickerWorkerId(workerId)}
                                                        >
                                                            <Plus size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <small className="settings-hint">Це кількість AdsPower-профілів, які один сценарій може використовувати одночасно. Працюють лише воркери з проксі.</small>
                                </section>

                                <section className="scale-setting comment-browser-setting">
                                    <div className="scale-setting-heading">
                                        <span>Браузер для коментарів</span>
                                    </div>
                                    <label className="field">
                                        <span>Режим запуску AdsPower</span>
                                        <select
                                            aria-label="Режим браузера для коментарів"
                                            value={commentBrowserMode}
                                            onChange={(event) => onCommentBrowserModeChange(event.target.value)}
                                        >
                                            <option value="visible">Звичайний браузер</option>
                                            <option value="headless">Headless (без вікна)</option>
                                        </select>
                                    </label>
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={commentDisableImages}
                                            onChange={(event) => onCommentDisableImagesChange(event.target.checked)}
                                        />
                                        <span>
                                            <strong>Не завантажувати зображення</strong>
                                            <small>Економить трафік лише на зображеннях. Відео, шрифти та інші ресурси продовжують завантажуватися.</small>
                                        </span>
                                    </label>
                                </section>
                            </>
                        )}

                        {tab === "keitaro" && (
                            <>
                                <p>Оберіть групи кампаній, які можна відкривати на вкладці Keitaro.</p>
                                <section className="scale-setting">
                                    <div className="scale-setting-heading">
                                        <span>Одночасні запити до Keitaro</span>
                                        <strong>{keitaroConcurrency}</strong>
                                    </div>
                                    <div className="scale-controls task-concurrency-controls">
                                        <button
                                            className="icon-button"
                                            type="button"
                                            disabled={keitaroConcurrency <= 1}
                                            onClick={() => onKeitaroConcurrencyChange(keitaroConcurrency - 1)}
                                        >
                                            <Minus size={15} />
                                        </button>
                                        <input
                                            aria-label="Одночасні запити до Keitaro"
                                            type="range"
                                            min="1"
                                            max="50"
                                            step="1"
                                            value={keitaroConcurrency}
                                            onChange={(event) => onKeitaroConcurrencyChange(
                                                Number(event.target.value)
                                            )}
                                        />
                                        <button
                                            className="icon-button"
                                            type="button"
                                            disabled={keitaroConcurrency >= 50}
                                            onClick={() => onKeitaroConcurrencyChange(keitaroConcurrency + 1)}
                                        >
                                            <Plus size={15} />
                                        </button>
                                    </div>
                                    <div className="scale-labels"><span>1</span><span>50</span></div>
                                    <small className="settings-hint">Якщо треба багато змін, програма шле їх не всі разом, а пачками по цій кількості. При 429 зачекає і повторить.</small>
                                </section>
                                <section className="scale-setting">
                                    <button
                                        type="button"
                                        className="select-trigger"
                                        aria-expanded={keitaroGroupsOpen}
                                        onClick={() => setKeitaroGroupsOpen((current) => !current)}
                                    >
                                        <span>
                                            <strong>Групи кампаній</strong>
                                            <small>Вибрано: {keitaroAvailableGroupIds.length}</small>
                                        </span>
                                        <ChevronDown size={17} />
                                    </button>
                                    {keitaroGroupsOpen && (
                                        <div className="keitaro-groups">
                                            {keitaroGroupsLoading && <div>Завантажуємо групи…</div>}
                                            {!keitaroGroupsLoading && keitaroGroups.length === 0 && (
                                                <div>Груп кампаній не знайдено.</div>
                                            )}
                                            {keitaroGroups.map((group) => {
                                                const groupId = String(group.id);
                                                const checked = keitaroAvailableGroupIds.includes(groupId);
                                                return (
                                                    <label key={groupId}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => onKeitaroAvailableGroupIdsChange(
                                                                checked
                                                                    ? keitaroAvailableGroupIds.filter((id) => id !== groupId)
                                                                    : [...keitaroAvailableGroupIds, groupId]
                                                            )}
                                                        />
                                                        <span>
                                                            {group.name}
                                                            <small> · {groupId}</small>
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </section>
                                <KeitaroCampaignSettings
                                    onError={onError}
                                    showToast={showToast}
                                />
                            </>
                        )}

                        {tab === "account-setup" && (
                            <>
                                <p>Воркер без проксі для оформлення акаунтів не використовується.</p>
                                <section className="scale-setting">
                                    <div className="scale-setting-heading">
                                        <span><ListChecks size={15} /> Браузери всередині оформлення</span>
                                        <strong>{accountSetupWorkerConcurrency}</strong>
                                    </div>
                                    <div className="scale-controls task-concurrency-controls">
                                        <button className="icon-button" disabled={accountSetupWorkerConcurrency <= 1} onClick={() => onAccountSetupWorkerConcurrencyChange(accountSetupWorkerConcurrency - 1)}><Minus size={15} /></button>
                                        <input aria-label="Паралельні браузери оформлення акаунтів" type="range" min="1" max="5" step="1" value={accountSetupWorkerConcurrency} onChange={(event) => onAccountSetupWorkerConcurrencyChange(Number(event.target.value))} />
                                        <button className="icon-button" disabled={accountSetupWorkerConcurrency >= 5} onClick={() => onAccountSetupWorkerConcurrencyChange(accountSetupWorkerConcurrency + 1)}><Plus size={15} /></button>
                                    </div>
                                    <div className="scale-labels"><span>1</span><span>5</span></div>
                                    <div className="comment-worker-grid">
                                        {Array.from({ length: accountSetupWorkerConcurrency }, (_, index) => {
                                            const workerId = index + 1;
                                            const proxyId = accountSetupWorkerProxyIds[String(workerId)];
                                            const proxy = proxies.find((item) => item.id === proxyId);
                                            return (
                                                <div className="comment-worker" key={workerId}>
                                                    <div className="comment-worker-id" aria-label={`Воркер оформлення ${workerId}`}>
                                                        {workerId}
                                                    </div>
                                                    {proxy ? (
                                                        <div className="comment-worker-proxy assigned">
                                                            <button
                                                                type="button"
                                                                title="Змінити проксі"
                                                                onClick={() => setPickerWorkerId(workerId)}
                                                            >
                                                                {proxy.name || proxy.id}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="icon-button"
                                                                title="Прибрати проксі"
                                                                onClick={() => clearProxy(workerId)}
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="comment-worker-proxy dashed"
                                                            aria-label={`Призначити проксі воркеру оформлення ${workerId}`}
                                                            onClick={() => setPickerWorkerId(workerId)}
                                                        >
                                                            <Plus size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <small className="settings-hint">Це кількість AdsPower-профілів, які сценарій оформлення може використовувати одночасно.</small>
                                </section>
                                <section className="scale-setting comment-browser-setting">
                                    <div className="scale-setting-heading">
                                        <span>Браузер для оформлення</span>
                                    </div>
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={accountSetupBrowserMode === "headless"}
                                            onChange={(event) => onAccountSetupBrowserModeChange(
                                                event.target.checked ? "headless" : "visible"
                                            )}
                                        />
                                        <span>
                                            <strong>Запускати без вікна</strong>
                                            <small>AdsPower відкриє браузер у фоні, без видимого вікна.</small>
                                        </span>
                                    </label>
                                </section>
                            </>
                        )}

                        {tab === "api-clients" && (
                            <>
                                <p>Синхронізація запускається окремою задачею в загальній черзі. Розмір браузера завжди встановлюється для половини 2K-монітора.</p>
                                <section className="scale-setting comment-browser-setting">
                                    <div className="scale-setting-heading"><span>Браузер для API-клієнтів</span></div>
                                    <label className="checkbox-line">
                                        <input
                                            type="checkbox"
                                            checked={apiClientsBrowserMode === "headless"}
                                            onChange={(event) => onApiClientsBrowserModeChange(event.target.checked ? "headless" : "visible")}
                                        />
                                        <span>
                                            <strong>Відкривати API-клієнти в безголовому режимі</strong>
                                            <small>Якщо увімкнено, синхронізація запускає AdsPower без видимого вікна.</small>
                                        </span>
                                    </label>
                                    <label className="checkbox-line">
                                        <input type="checkbox" checked={apiClientsDisableImages} onChange={(event) => onApiClientsDisableImagesChange(event.target.checked)} />
                                        <span>
                                            <strong>Не завантажувати зображення</strong>
                                            <small>Під час синхронізації AdsPower не завантажує зображення.</small>
                                        </span>
                                    </label>
                                </section>
                            </>
                        )}

                        {tab === "spend" && (
                            <SpendSettings onError={onError} showToast={showToast} />
                        )}

                        <div className="form-actions settings-actions">
                            {tab === "general" && (
                                <button className="secondary-button" onClick={() => change(130)}>
                                    <RotateCcw size={14} /> Повернути 130%
                                </button>
                            )}
                            <span className="action-spacer" />
                            <button className="primary-button" onClick={onClose}>Готово</button>
                        </div>
                    </div>
                </div>
            </motion.div>
            {pickerWorkerId && (
                <WorkerProxyPicker
                    workerId={pickerWorkerId}
                    proxies={proxies}
                    proxiesLoading={proxiesLoading}
                    excludedIds={assignedIds}
                    selectedId={activeProxyIds[String(pickerWorkerId)] ?? null}
                    onCreate={onCreateProxy}
                    onUpdate={onUpdateProxy}
                    onDelete={onDeleteProxy}
                    onGet={onGetProxy}
                    onCheck={onCheckProxy}
                    onCheckConfig={onCheckProxyConfig}
                    onRefreshIp={onRefreshProxyIp}
                    onError={onError}
                    onConfirm={(proxyId) => {
                        assignProxy(pickerWorkerId, proxyId);
                        setPickerWorkerId(null);
                    }}
                    onClose={() => setPickerWorkerId(null)}
                />
            )}
        </div>
    );
}
