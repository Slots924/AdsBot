import { useEffect, useMemo, useRef, useState } from "react";
import { motion, Reorder, useDragControls } from "framer-motion";
import {
    AlertCircle,
    BadgeDollarSign,
    Check,
    CircleMinus,
    CirclePlus,
    GripVertical,
    LoaderCircle,
    Megaphone,
    Pencil,
    RefreshCw,
    ShieldAlert,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import CampaignCreationWizard
    from "../components/CampaignCreationWizard.jsx";


const datePresets = [
    { id: "today", label: "Сьогодні" },
    { id: "yesterday", label: "Учора" },
    { id: "last_7d", label: "7 днів" },
    { id: "last_30d", label: "30 днів" },
    { id: "maximum", label: "Весь час" },
];


function value(current) {
    return current === null || current === undefined || current === ""
        ? "—"
        : current;
}


function compareNames(left, right) {
    return left.localName.localeCompare(right.localName, "uk-UA", {
        numeric: true,
        sensitivity: "base",
    });
}


function formatMoney(amount, currency) {
    if (amount === null || amount === undefined) return "—";
    try {
        return new Intl.NumberFormat("uk-UA", {
            style: "currency",
            currency: currency || "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
    }
}


function inactiveReason(account) {
    if (account.status === "active") return null;
    if (account.disableReason?.code !== null) {
        return account.disableReason?.label || "Рекламний акаунт вимкнено";
    }
    return `Неактивний статус Meta: ${account.accountStatus}`;
}


function AccountCard({
    account,
    selected,
    favorite,
    onSelect,
    onRename,
    onToggleFavorite,
    dragControls,
}) {
    const reason = inactiveReason(account);

    return (
        <div
            className={`ad-account-card ${selected ? "selected" : ""} ${account.status !== "active" ? "inactive" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(account.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    onSelect(account.id);
                }
            }}
        >
            <button
                className={`ad-drag-handle ${favorite ? "enabled" : ""}`}
                type="button"
                title={favorite ? "Змінити порядок" : "Порядок визначається автоматично"}
                disabled={!favorite}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    dragControls?.start(event);
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <GripVertical size={16} />
            </button>

            <span className={`status-dot ${account.status === "active" ? "active" : "inactive"}`} />
            <span className="ad-account-card-copy">
                <strong>{account.localName}</strong>
                <span>{account.name}</span>
                <small>{account.accountId} · {account.id}</small>
                {reason && <em>{reason}</em>}
            </span>

            <span className="ad-account-card-actions">
                <button
                    className="ad-card-action"
                    type="button"
                    title="Перейменувати"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRename(account);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <Pencil size={13} />
                </button>
                <button
                    className="ad-card-action"
                    type="button"
                    title={favorite ? "Забрати з обраних" : "Додати до обраних"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite(account, !favorite);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    {favorite
                        ? <CircleMinus size={15} />
                        : <CirclePlus size={15} />}
                </button>
            </span>
        </div>
    );
}


function FavoriteAccountItem(props) {
    const dragControls = useDragControls();
    return (
        <Reorder.Item
            as="div"
            value={props.account.id}
            dragListener={false}
            dragControls={dragControls}
            onDragEnd={props.onDragEnd}
        >
            <AccountCard {...props} favorite dragControls={dragControls} />
        </Reorder.Item>
    );
}


function CampaignTable({ entry, currency, onRetry }) {
    if (!entry || entry.status === "loading") {
        return (
            <div className="campaign-table-card">
                <div className="campaign-loading">
                    <LoaderCircle className="spin" size={21} />
                    Завантажуємо кампанії та статистику…
                </div>
                {[1, 2, 3].map((row) => (
                    <div key={row} className="campaign-skeleton skeleton" />
                ))}
            </div>
        );
    }

    if (entry.status === "error") {
        return (
            <div className="campaign-error">
                <AlertCircle size={24} />
                <strong>Не вдалося завантажити кампанії</strong>
                <span>{entry.error}</span>
                <button className="secondary-button" onClick={onRetry}>
                    <RefreshCw size={14} /> Спробувати ще раз
                </button>
            </div>
        );
    }

    const campaigns = entry.data.campaigns;
    return (
        <div className="campaign-table-card">
            <div className="campaign-table-head campaign-grid">
                <span>№</span>
                <span>Назва кампанії</span>
                <span>Статус</span>
                <span>Ліди</span>
                <span>Spend</span>
                <span>Ціна за лід</span>
            </div>
            {campaigns.length === 0 && (
                <div className="campaign-empty">
                    За цей період активних або призупинених кампаній немає.
                </div>
            )}
            {campaigns.map((campaign, index) => (
                <div className="campaign-row campaign-grid" key={campaign.id}>
                    <span className="campaign-number">{index + 1}</span>
                    <span className="campaign-name">
                        <strong>{campaign.name}</strong>
                        <small>{campaign.id}</small>
                    </span>
                    <span>
                        <i className={`campaign-status ${campaign.effectiveStatus === "ACTIVE" ? "active" : "paused"}`}>
                            {campaign.effectiveStatus === "ACTIVE" ? "Увімкнено" : "Пауза"}
                        </i>
                    </span>
                    <strong>{campaign.leads}</strong>
                    <strong>{formatMoney(campaign.spend, currency)}</strong>
                    <strong>{formatMoney(campaign.costPerLead, currency)}</strong>
                </div>
            ))}
        </div>
    );
}


export default function AdAccountsTab({
    selectedAccount,
    onError,
    showToast = () => {},
    addLog = () => {},
    selectedId: controlledSelectedId,
    setSelectedId: setControlledSelectedId,
    createCampaignsPaused = true,
    defaultPixelId = "",
    defaultUtm = "",
    lastPublishedPost = null,
    workspaceAccounts = null,
    onWorkspaceRefresh = null,
    onWorkspaceAccountsChange = null,
}) {
    const [accounts, setAccounts] = useState([]);
    const [localSelectedId, setLocalSelectedId] = useState("");
    const [loading, setLoading] = useState(false);
    const [datePreset, setDatePreset] = useState("today");
    const [campaignRefreshVersion, setCampaignRefreshVersion] = useState(0);
    const [campaignCache, setCampaignCache] = useState({});
    const [renameEditor, setRenameEditor] = useState(null);
    const [renaming, setRenaming] = useState(false);
    const [campaignWizardOpen, setCampaignWizardOpen] = useState(false);
    const requestSequence = useRef(0);
    const campaignCacheRef = useRef({});
    const campaignRequestIds = useRef({});
    const campaignClientVersions = useRef({});
    const favoriteOrderRef = useRef([]);
    const accountActive = selectedAccount?.status === "active";
    const selectedId = controlledSelectedId ?? localSelectedId;
    const setSelectedId = setControlledSelectedId ?? setLocalSelectedId;
    const selected = accounts.find((account) => account.id === selectedId);
    const accountKey = selectedAccount?.accountKey ?? "";

    const favorites = useMemo(() => accounts
        .filter((account) => account.isFavorite)
        .sort((left, right) => left.favoritePosition - right.favoritePosition), [accounts]);
    const others = useMemo(() => accounts
        .filter((account) => !account.isFavorite)
        .sort((left, right) => {
            const statusDifference = Number(right.status === "active")
                - Number(left.status === "active");
            return statusDifference || compareNames(left, right);
        }), [accounts]);

    favoriteOrderRef.current = favorites.map((account) => account.id);

    const updateCampaignCache = (updater) => {
        const next = typeof updater === "function"
            ? updater(campaignCacheRef.current)
            : updater;
        campaignCacheRef.current = next;
        setCampaignCache(next);
    };

    const campaignKey = (adAccountId, preset = datePreset) => (
        `${accountKey}::${adAccountId}::${preset}`
    );

    const loadCampaigns = async (
        adAccountId,
        preset = datePreset,
        { force = false, background = false } = {}
    ) => {
        if (!accountKey || !adAccountId) return null;
        const key = campaignKey(adAccountId, preset);
        const current = campaignCacheRef.current[key];
        if (!force && ["loading", "ready"].includes(current?.status)) {
            return current;
        }

        updateCampaignCache((cache) => ({
            ...cache,
            [key]: { status: "loading", data: null, error: null },
        }));
        const requestId = (campaignRequestIds.current[key] ?? 0) + 1;
        campaignRequestIds.current[key] = requestId;
        const clientVersion = campaignClientVersions.current[accountKey] ?? 0;

        try {
            const data = await unwrap(window.adsBot.getAdCampaigns(
                accountKey,
                adAccountId,
                preset
            ));
            const entry = { status: "ready", data, error: null };
            if (
                campaignRequestIds.current[key] !== requestId
                || (campaignClientVersions.current[accountKey] ?? 0) !== clientVersion
            ) {
                return null;
            }
            updateCampaignCache((cache) => ({ ...cache, [key]: entry }));
            return entry;
        } catch (error) {
            const entry = {
                status: "error",
                data: null,
                error: error.message,
            };
            if (
                campaignRequestIds.current[key] !== requestId
                || (campaignClientVersions.current[accountKey] ?? 0) !== clientVersion
            ) {
                return null;
            }
            updateCampaignCache((cache) => ({ ...cache, [key]: entry }));
            if (background) {
                addLog(
                    "warn",
                    "frontend",
                    `Фонове завантаження кампаній ${adAccountId}: ${error.message}`
                );
            }
            return entry;
        }
    };

    const loadAccounts = async ({ refreshCampaigns = false } = {}) => {
        if (!accountActive) return;
        const sequence = ++requestSequence.current;
        setLoading(true);

        if (refreshCampaigns) {
            campaignClientVersions.current[accountKey] = (
                campaignClientVersions.current[accountKey] ?? 0
            ) + 1;
            updateCampaignCache((cache) => Object.fromEntries(
                Object.entries(cache).filter(
                    ([key]) => !key.startsWith(`${accountKey}::`)
                )
            ));
            setCampaignRefreshVersion((current) => current + 1);
        }

        try {
            const nextAccounts = await unwrap(
                window.adsBot.getAdAccounts(accountKey)
            );
            if (sequence !== requestSequence.current) return;
            setAccounts(nextAccounts);
            onWorkspaceAccountsChange?.(nextAccounts);
            setSelectedId((current) => nextAccounts.some(
                (account) => account.id === current
            ) ? current : "");
        } catch (error) {
            if (sequence === requestSequence.current) {
                onError({
                    ...errorDetails(error),
                    title: "Не вдалося завантажити РК",
                });
            }
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        requestSequence.current += 1;
        setAccounts([]);
        if (Array.isArray(workspaceAccounts)) {
            setAccounts(workspaceAccounts);
            return;
        }
        if (accountActive) loadAccounts();
    }, [accountKey, accountActive, workspaceAccounts]);

    useEffect(() => {
        if (selected) loadCampaigns(selected.id, datePreset);
    }, [selected?.id, datePreset, accountKey, campaignRefreshVersion]);

    const updateFavoritePositions = (orderedIds) => {
        const positions = new Map(orderedIds.map((id, index) => [id, index]));
        setAccounts((current) => {
            const next = current.map((account) => ({
                ...account,
                isFavorite: positions.has(account.id),
                favoritePosition: positions.get(account.id) ?? null,
            }));
            onWorkspaceAccountsChange?.(next);
            return next;
        });
    };

    const toggleFavorite = async (account, isFavorite) => {
        try {
            const orderedIds = await unwrap(window.adsBot.setAdAccountFavorite(
                accountKey,
                account.id,
                isFavorite
            ));
            updateFavoritePositions(orderedIds);
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося змінити обрані РК",
            });
        }
    };

    const reorderFavorites = (orderedIds) => {
        favoriteOrderRef.current = orderedIds;
        updateFavoritePositions(orderedIds);
    };

    const saveFavoriteOrder = async () => {
        try {
            await unwrap(window.adsBot.reorderFavoriteAdAccounts(
                accountKey,
                favoriteOrderRef.current
            ));
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося зберегти порядок РК",
            });
            loadAccounts();
        }
    };

    const saveRename = async (event) => {
        event.preventDefault();
        const name = renameEditor?.name.trim();
        if (!name || renaming) return;
        setRenaming(true);
        try {
            const result = await unwrap(window.adsBot.renameAdAccount(
                renameEditor.id,
                name
            ));
            setAccounts((current) => {
                const next = current.map((account) => (
                    account.id === result.adAccountId
                        ? { ...account, localName: result.localName }
                        : account
                ));
                onWorkspaceAccountsChange?.(next);
                return next;
            });
            setRenameEditor(null);
            showToast("Назву РК збережено", "success");
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося перейменувати РК",
            });
        } finally {
            setRenaming(false);
        }
    };

    const currentCampaignEntry = selected
        ? campaignCache[campaignKey(selected.id)]
        : null;

    return (
        <motion.section className="ad-accounts-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="ad-workspace-heading">
                <div>
                    <span className="eyebrow">Meta Ads</span>
                    <h1>Рекламні кабінети</h1>
                    <p>Обрані кабінети, статуси та статистика кампаній.</p>
                </div>
                <button
                    className="secondary-button"
                    disabled={!accountActive || loading}
                    onClick={() => loadAccounts({ refreshCampaigns: true })}
                >
                    <RefreshCw className={loading ? "spin" : ""} size={16} />
                    Оновити РК
                </button>
            </div>

            {!accountActive && (
                <div className="notice danger ad-account-notice">
                    <ShieldAlert size={17} /> Оберіть активний Facebook-акаунт.
                </div>
            )}

            <div className="ad-accounts-workspace">
                <aside className="ad-account-browser">
                    <section className="ad-account-section favorites">
                        <header>
                            <span>Обрані РК</span>
                            <b>{favorites.length}</b>
                        </header>
                        {loading && accounts.length === 0 && (
                            <div className="ad-list-loading"><LoaderCircle className="spin" size={20} /> Завантажуємо РК…</div>
                        )}
                        {!loading && favorites.length === 0 && (
                            <div className="ad-list-empty">Додайте потрібні РК кнопкою плюс.</div>
                        )}
                        <Reorder.Group
                            as="div"
                            axis="y"
                            className="ad-account-list"
                            values={favorites.map((account) => account.id)}
                            onReorder={reorderFavorites}
                        >
                            {favorites.map((account) => (
                                <FavoriteAccountItem
                                    key={account.id}
                                    account={account}
                                    selected={selectedId === account.id}
                                    onSelect={setSelectedId}
                                    onRename={(current) => setRenameEditor({
                                        id: current.id,
                                        name: current.localName,
                                    })}
                                    onToggleFavorite={toggleFavorite}
                                    onDragEnd={saveFavoriteOrder}
                                />
                            ))}
                        </Reorder.Group>
                    </section>

                    <div className="ad-account-divider"><span>Інші РК</span></div>

                    <section className="ad-account-section others">
                        {!loading && others.length === 0 && accounts.length > 0 && (
                            <div className="ad-list-empty">Усі доступні РК уже обрано.</div>
                        )}
                        <div className="ad-account-list">
                            {others.map((account) => (
                                <AccountCard
                                    key={account.id}
                                    account={account}
                                    selected={selectedId === account.id}
                                    favorite={false}
                                    onSelect={setSelectedId}
                                    onRename={(current) => setRenameEditor({
                                        id: current.id,
                                        name: current.localName,
                                    })}
                                    onToggleFavorite={toggleFavorite}
                                />
                            ))}
                        </div>
                    </section>
                </aside>

                <div className="ad-account-main">
                    {!selected && (
                        <div className="ad-detail-placeholder">
                            <BadgeDollarSign size={35} />
                            <strong>Оберіть рекламний кабінет</strong>
                            <span>Тут з’являться його інформація та кампанії.</span>
                        </div>
                    )}

                    {selected && (
                        <>
                            <motion.div className="ad-detail compact" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                                <header>
                                    <div>
                                        <span className={`status-pill ${selected.status}`}>{selected.status}</span>
                                        <h2>{selected.localName}</h2>
                                        <p>{selected.name} · {selected.accountId} · {selected.id}</p>
                                    </div>
                                    <div className="ad-detail-actions">
                                        {selected.status === "active" && (
                                            <button className="primary-button" onClick={() => setCampaignWizardOpen(true)}>
                                                <Megaphone size={16} /> Створити кампанію
                                            </button>
                                        )}
                                        {selected.status !== "active" && (
                                            <div className="reason-card">
                                                <span>Причина Meta #{value(selected.disableReason?.code)}</span>
                                                <strong>{inactiveReason(selected)}</strong>
                                            </div>
                                        )}
                                    </div>
                                </header>
                                <div className="detail-grid compact">
                                    <div><span>Business</span><strong>{value(selected.business?.name)}</strong><small>{value(selected.business?.id)}</small></div>
                                    <div><span>Owner</span><strong>{value(selected.owner)}</strong></div>
                                    <div><span>Валюта</span><strong>{value(selected.currency)}</strong></div>
                                    <div><span>Часовий пояс</span><strong>{value(selected.timezoneName)}</strong></div>
                                    <div><span>Витрачено</span><strong>{value(selected.amountSpent)}</strong></div>
                                    <div><span>Баланс</span><strong>{value(selected.balance)}</strong></div>
                                    <div><span>Spend cap</span><strong>{value(selected.spendCap)}</strong></div>
                                    <div><span>Створено</span><strong>{value(selected.createdTime)}</strong></div>
                                    <div><span>DSA beneficiary</span><strong>{value(selected.defaultDsaBeneficiary)}</strong></div>
                                    <div><span>DSA payor</span><strong>{value(selected.defaultDsaPayor)}</strong></div>
                                </div>
                            </motion.div>

                            <div className="campaign-heading">
                                <div>
                                    <span className="eyebrow">Campaign performance</span>
                                    <h2>Кампанії</h2>
                                </div>
                                <div className="campaign-periods">
                                    {datePresets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            className={datePreset === preset.id ? "active" : ""}
                                            onClick={() => setDatePreset(preset.id)}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <CampaignTable
                                entry={currentCampaignEntry}
                                currency={selected.currency}
                                onRetry={() => loadCampaigns(
                                    selected.id,
                                    datePreset,
                                    { force: true }
                                )}
                            />
                        </>
                    )}
                </div>
            </div>

            {renameEditor && (
                <div className="overlay" onMouseDown={() => !renaming && setRenameEditor(null)}>
                    <motion.form
                        className="modal ad-rename-modal"
                        initial={{ opacity: 0, y: 20, scale: .97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onSubmit={saveRename}
                    >
                        <button className="modal-close" type="button" disabled={renaming} onClick={() => setRenameEditor(null)}>
                            <X size={17} />
                        </button>
                        <div className="modal-icon template-icon"><Pencil /></div>
                        <span className="eyebrow">Локальна назва</span>
                        <h2>Перейменувати РК</h2>
                        <p>Назва буде спільною для цього Graph ID у всіх API-клієнтах.</p>
                        <label className="field">
                            <span>Назва</span>
                            <input
                                autoFocus
                                value={renameEditor.name}
                                onChange={(event) => setRenameEditor((current) => ({
                                    ...current,
                                    name: event.target.value,
                                }))}
                            />
                        </label>
                        <div className="form-actions">
                            <button className="secondary-button" type="button" onClick={() => setRenameEditor(null)}>
                                Скасувати
                            </button>
                            <button className="primary-button" type="submit" disabled={!renameEditor.name.trim() || renaming}>
                                {renaming ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                                Зберегти
                            </button>
                        </div>
                    </motion.form>
                </div>
            )}
            {campaignWizardOpen && selected && (
                <CampaignCreationWizard
                    accountKey={accountKey}
                    adAccount={selected}
                    createPaused={createCampaignsPaused}
                    defaultPixelId={defaultPixelId}
                    defaultUtm={defaultUtm}
                    lastPublishedPost={lastPublishedPost}
                    onClose={() => setCampaignWizardOpen(false)}
                    onSuccess={() => {
                        showToast("Кампанію додано в чергу", "success");
                    }}
                />
            )}
        </motion.section>
    );
}
