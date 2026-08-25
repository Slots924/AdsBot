import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Reorder, motion, useDragControls } from "framer-motion";
import {
    Flashlight,
    FlashlightOff,
    GripVertical,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    ShieldCheck,
    X,
} from "lucide-react";

import { errorDetails } from "../lib/api.js";
import parseProxyPaste from "../../../services/proxy/parseProxyPaste.js";


const emptyExcludedIds = [];
const proxyTypes = [
    { value: "socks5", label: "Socks5" },
    { value: "http", label: "HTTP" },
    { value: "https", label: "HTTPS" },
    { value: "no_proxy", label: "Без проксі" },
];


function emptyProxyDraft() {
    return {
        adsPowerId: "",
        name: "",
        type: "socks5",
        host: "",
        port: "",
        username: "",
        password: "",
        refreshUrl: "",
    };
}


function ProxyEditor({ editor, onClose, onSave, onCheckConfig, onError }) {
    const [draft, setDraft] = useState(() => ({
        ...emptyProxyDraft(),
        adsPowerId: editor.adsPowerId ?? "",
        name: editor.name ?? "",
        type: editor.type ?? "socks5",
        host: editor.host ?? "",
        port: editor.port ?? "",
        username: editor.username ?? "",
        password: editor.password ?? "",
        refreshUrl: editor.refreshUrl ?? "",
    }));
    const [paste, setPaste] = useState("");
    const [pasteError, setPasteError] = useState("");
    const [check, setCheck] = useState({ state: "idle", ip: null, error: null });
    const [saving, setSaving] = useState(false);
    const creating = editor.mode === "create";
    const withoutProxy = draft.type === "no_proxy";
    const update = (field) => (event) => setDraft((current) => ({
        ...current,
        [field]: event.target.value,
    }));
    const canSave = creating
        ? withoutProxy || (draft.host.trim() && draft.port.trim())
        : true;

    const applyPaste = () => {
        const parsed = parseProxyPaste(paste);
        if (!parsed.ok) {
            setPasteError(parsed.message);
            return;
        }
        setPasteError("");
        setCheck({ state: "idle", ip: null, error: null });
        setDraft((current) => ({
            ...current,
            type: parsed.type || current.type,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            password: parsed.password,
            refreshUrl: parsed.refreshUrl,
        }));
    };

    const checkDraft = async () => {
        if (withoutProxy || check.state === "busy") return;
        setCheck({ state: "busy", ip: null, error: null });
        try {
            const result = await onCheckConfig({
                proxyId: editor.proxyId,
                type: draft.type,
                host: draft.host,
                port: draft.port,
                username: draft.username,
                password: draft.password,
            });
            setCheck({
                state: result.working ? "ok" : "fail",
                ip: result.ip ?? null,
                error: result.working ? null : result.error || "Проксі не відповідає",
            });
        } catch (error) {
            setCheck({ state: "fail", ip: null, error: error.message });
            onError({
                ...errorDetails(error),
                title: "Не вдалося перевірити проксі",
            });
        }
    };

    const submit = async (event) => {
        event.preventDefault();
        if (!canSave || saving) return;
        setSaving(true);
        try {
            await onSave(draft);
            onClose();
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: creating
                    ? "Не вдалося додати проксі"
                    : "Не вдалося оновити проксі",
            });
        } finally {
            setSaving(false);
        }
    };

    const panel = (
        <motion.form
            className="proxy-editor"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={submit}
        >
            <header className="proxy-editor-heading">
                <div>
                    <span className="eyebrow">Проксі</span>
                    <h1>{creating ? "Нова проксі" : "Змінити проксі"}</h1>
                </div>
                <button className="icon-button" type="button" disabled={saving} onClick={onClose} title="Закрити">
                    <X size={18} />
                </button>
            </header>
            <div className="proxy-editor-rows">
                    <label className="proxy-editor-row">
                        <span>Тип проксі</span>
                        <select value={draft.type} onChange={update("type")}>
                            {proxyTypes.map((type) => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                            ))}
                        </select>
                    </label>
                    <div className="proxy-editor-row">
                        <span>Вставити проксі</span>
                        <div className="proxy-editor-control">
                            <input
                                aria-label="Вставити проксі"
                                value={paste}
                                disabled={withoutProxy}
                                onChange={(event) => {
                                    setPaste(event.target.value);
                                    setPasteError("");
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        applyPaste();
                                    }
                                }}
                                placeholder="socks5://host:port:login:password[https://…]"
                            />
                            <button
                                className="secondary-button"
                                type="button"
                                disabled={withoutProxy || !paste.trim()}
                                onClick={applyPaste}
                            >
                                ОК
                            </button>
                            <button
                                className={`secondary-button ${check.state === "ok" ? "proxy-check-ok" : ""} ${check.state === "fail" ? "proxy-check-fail" : ""}`}
                                type="button"
                                disabled={withoutProxy || check.state === "busy" || !draft.host || !draft.port}
                                onClick={checkDraft}
                            >
                                {check.state === "busy"
                                    ? <LoaderCircle className="spin" size={15} />
                                    : null}
                                Перевірити проксі
                            </button>
                        </div>
                    </div>
                    {(pasteError || check.ip || check.error) && (
                        <div className="proxy-editor-note">
                            {pasteError && <em>{pasteError}</em>}
                            {check.ip && <small>IP {check.ip}</small>}
                            {check.error && <em>{check.error}</em>}
                        </div>
                    )}
                    <label className="proxy-editor-row">
                        <span>AdsPower ID</span>
                        <input
                            autoFocus={creating}
                            inputMode="numeric"
                            value={draft.adsPowerId}
                            onChange={update("adsPowerId")}
                            placeholder="Необов’язково"
                        />
                    </label>
                    <label className="proxy-editor-row">
                        <span>Ім’я</span>
                        <input
                            value={draft.name}
                            onChange={update("name")}
                            placeholder="Може повторюватися"
                        />
                    </label>
                    <div className="proxy-editor-row">
                        <span>Хост:Порт</span>
                        <div className="proxy-host-port">
                            <input
                                aria-label="Хост"
                                value={draft.host}
                                disabled={withoutProxy}
                                onChange={update("host")}
                                placeholder="proxy.example.com"
                            />
                            <span>:</span>
                            <input
                                aria-label="Порт"
                                inputMode="numeric"
                                value={draft.port}
                                disabled={withoutProxy}
                                onChange={update("port")}
                                placeholder="10000"
                            />
                        </div>
                    </div>
                    <label className="proxy-editor-row">
                        <span>Логін проксі</span>
                        <input
                            aria-label="Логін проксі"
                            value={draft.username}
                            disabled={withoutProxy}
                            onChange={update("username")}
                            placeholder="Необов’язково"
                        />
                    </label>
                    <label className="proxy-editor-row">
                        <span>Пароль проксі</span>
                        <input
                            aria-label="Пароль проксі"
                            value={draft.password}
                            disabled={withoutProxy}
                            onChange={update("password")}
                            placeholder="Необов’язково"
                        />
                    </label>
                    <label className="proxy-editor-row">
                        <span>Посилання для зміни IP</span>
                        <input
                            aria-label="Посилання для зміни IP"
                            value={draft.refreshUrl}
                            disabled={withoutProxy}
                            onChange={update("refreshUrl")}
                            placeholder="https://…"
                        />
                    </label>
                </div>
            <div className="proxy-editor-actions">
                <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Скасувати</button>
                <button className="primary-button" type="submit" disabled={!canSave || saving}>
                    {saving && <LoaderCircle className="spin" size={16} />}
                    {creating ? "Додати" : "Зберегти"}
                </button>
            </div>
        </motion.form>
    );
    const overlay = <div className="proxy-editor-overlay">{panel}</div>;
    const host = document.querySelector(".worker-proxy-picker-modal")
        || document.querySelector(".accounts-tab");
    return host ? createPortal(overlay, host) : overlay;
}


function ProxyCard({
    proxy,
    index,
    status,
    apiDefault,
    selectable,
    selected,
    canReorder,
    busyId,
    onSelect,
    onDragEnd,
    onCheckStatus,
    onRefreshIp,
    onEdit,
    onRemove,
}) {
    const dragControls = useDragControls();
    const flashlightOn = status.working === true;
    const flashlightOff = status.working === false;
    const card = (
        <div
            className={`account-card proxy-card ${selected ? "selected" : ""} ${selectable ? "selectable" : ""}`}
            onClick={() => selectable && onSelect?.(proxy.id)}
        >
            {canReorder && (
                <button
                    className="ad-drag-handle enabled"
                    type="button"
                    title="Змінити порядок"
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        dragControls.start(event);
                    }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <GripVertical size={16} />
                </button>
            )}
            <span
                className={`proxy-flashlight ${flashlightOn ? "on" : flashlightOff ? "off" : "unknown"}`}
                title={flashlightOn ? "Проксі активна" : flashlightOff ? "Проксі неактивна" : "Статус ще не перевірено"}
            >
                {flashlightOff ? <FlashlightOff size={16} /> : <Flashlight size={16} />}
            </span>
            <span className="account-copy">
                <strong>{proxy.adsPowerId ?? "Без AdsPower ID"}</strong>
                <span>{proxy.name || "Без імені"}</span>
                {apiDefault && <small className="proxy-api-badge">API</small>}
                {status.ip && <small>IP {status.ip}</small>}
            </span>
            <span className="proxy-card-actions">
                <button
                    type="button"
                    className="icon-button"
                    title="Перевірити статус"
                    disabled={status.checking || proxy.type === "no_proxy"}
                    onClick={(event) => onCheckStatus(event, proxy)}
                >
                    {status.checking
                        ? <LoaderCircle className="spin" size={13} />
                        : <ShieldCheck size={13} />}
                </button>
                <button
                    type="button"
                    className={`icon-button ${status.refresh === "ok" ? "success" : ""} ${status.refresh === "fail" ? "fail" : ""}`}
                    title={proxy.hasRefreshUrl ? "Оновити IP" : "Немає посилання для зміни IP"}
                    disabled={!proxy.hasRefreshUrl || status.refresh === "busy"}
                    onClick={(event) => onRefreshIp(event, proxy)}
                >
                    <RefreshCw className={status.refresh === "busy" ? "spin" : ""} size={13} />
                </button>
                <button
                    type="button"
                    className="icon-button"
                    title="Редагувати"
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit(proxy);
                    }}
                >
                    <Pencil size={13} />
                </button>
                <button
                    type="button"
                    className="icon-button danger"
                    title="Видалити"
                    disabled={busyId === proxy.id}
                    onClick={(event) => onRemove(event, proxy)}
                >
                    {busyId === proxy.id
                        ? <LoaderCircle className="spin" size={13} />
                        : <X size={13} />}
                </button>
            </span>
        </div>
    );

    if (!canReorder) {
        return (
            <motion.div
                className="account-card-shell proxy-card-shell"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * .045 }}
            >
                {card}
            </motion.div>
        );
    }

    return (
        <Reorder.Item
            as="div"
            className="account-card-shell proxy-card-shell"
            value={proxy.id}
            dragListener={false}
            dragControls={dragControls}
            onDragEnd={onDragEnd}
        >
            {card}
        </Reorder.Item>
    );
}


export default function ProxyStrip({
    proxies,
    loading,
    onCreate,
    onUpdate,
    onDelete,
    onGet,
    onCheck,
    onCheckConfig,
    onRefreshIp,
    onReorder,
    onError,
    variant = "strip",
    selectable = false,
    selectedId = null,
    excludedIds = emptyExcludedIds,
    autoCheck = false,
    onSelect,
}) {
    const [editor, setEditor] = useState(null);
    const [statuses, setStatuses] = useState({});
    const [busyId, setBusyId] = useState(null);
    const [orderedIds, setOrderedIds] = useState(proxies.map((proxy) => proxy.id));
    const orderedIdsRef = { current: orderedIds };
    orderedIdsRef.current = orderedIds;
    const excluded = useMemo(() => new Set(excludedIds), [excludedIds]);
    const visibleProxies = useMemo(
        () => proxies.filter((proxy) => !excluded.has(proxy.id)),
        [proxies, excluded]
    );
    const canReorder = typeof onReorder === "function" && !selectable;
    const apiDefaultId = proxies.find((proxy) => proxy.type !== "no_proxy")?.id ?? null;

    useEffect(() => {
        const next = visibleProxies.map((proxy) => proxy.id);
        setOrderedIds((current) => (
            current.length === next.length
            && current.every((id, index) => id === next[index])
                ? current
                : next
        ));
    }, [visibleProxies]);

    useEffect(() => {
        if (!autoCheck) return undefined;
        visibleProxies.forEach((proxy) => {
            if (proxy.type === "no_proxy") return;
            checkStatus({ stopPropagation() {} }, proxy);
        });
        return undefined;
    }, [autoCheck]);

    const saveProxy = (draft) => editor.mode === "create"
        ? onCreate(draft)
        : onUpdate(editor.proxyId, draft);

    const patchStatus = (proxyId, patch) => {
        setStatuses((current) => ({
            ...current,
            [proxyId]: { ...current[proxyId], ...patch },
        }));
    };

    const checkStatus = async (event, proxy) => {
        event.stopPropagation();
        patchStatus(proxy.id, { checking: true });
        try {
            const result = await onCheck(proxy.id);
            patchStatus(proxy.id, {
                checking: false,
                working: Boolean(result.working),
                ip: result.ip ?? null,
            });
        } catch (error) {
            patchStatus(proxy.id, { checking: false, working: false, ip: null });
            onError({
                ...errorDetails(error),
                title: "Не вдалося перевірити проксі",
            });
        }
    };

    const refreshIp = async (event, proxy) => {
        event.stopPropagation();
        if (!proxy.hasRefreshUrl) return;
        patchStatus(proxy.id, { refresh: "busy" });
        try {
            const result = await onRefreshIp(proxy.id);
            patchStatus(proxy.id, {
                refresh: result.working ? "ok" : "fail",
                working: Boolean(result.working),
                ip: result.ip ?? null,
            });
        } catch (error) {
            patchStatus(proxy.id, { refresh: "fail", working: false, ip: null });
            onError({
                ...errorDetails(error),
                title: "Не вдалося змінити IP",
            });
        }
    };

    const removeProxy = async (event, proxy) => {
        event.stopPropagation();
        if (!window.confirm(`Видалити проксі «${proxy.name || proxy.id}»?`)) return;
        setBusyId(proxy.id);
        try {
            await onDelete(proxy.id);
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося видалити проксі",
            });
        } finally {
            setBusyId(null);
        }
    };

    const openEditor = async (proxy) => {
        try {
            const details = onGet ? await onGet(proxy.id) : proxy;
            setEditor({
                mode: "edit",
                proxyId: details.id ?? proxy.id,
                adsPowerId: details.adsPowerId ?? "",
                name: details.name ?? "",
                type: details.type ?? "socks5",
                host: details.host ?? "",
                port: details.port ?? "",
                username: details.username ?? "",
                password: details.password ?? "",
                refreshUrl: details.refreshUrl ?? "",
            });
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося відкрити проксі",
            });
        }
    };

    const orderedProxies = orderedIds
        .map((id) => visibleProxies.find((proxy) => proxy.id === id))
        .filter(Boolean);
    const listItems = loading && visibleProxies.length === 0
        ? [1, 2, 3].map((item) => <div className="account-card skeleton" key={item} />)
        : orderedProxies.map((proxy, index) => (
            <ProxyCard
                key={proxy.id}
                proxy={proxy}
                index={index}
                status={statuses[proxy.id] || {}}
                apiDefault={proxy.id === apiDefaultId}
                selectable={selectable}
                selected={selectedId === proxy.id}
                canReorder={canReorder}
                busyId={busyId}
                onSelect={onSelect}
                onDragEnd={() => onReorder?.(orderedIdsRef.current)}
                onCheckStatus={checkStatus}
                onRefreshIp={refreshIp}
                onEdit={openEditor}
                onRemove={removeProxy}
            />
        ));

    return (
        <aside className={`sidebar accounts-tab-sidebar resource-strip ${variant === "picker" ? "proxy-picker-strip" : ""}`}>
            <div className="sidebar-title-row">
                <div>
                    <span className="eyebrow">Пул</span>
                    <h2>Проксі</h2>
                </div>
                <b className="strip-count">{visibleProxies.length}</b>
            </div>
            {canReorder ? (
                <Reorder.Group
                    as="div"
                    axis="y"
                    className="account-list"
                    values={orderedIds}
                    onReorder={(ids) => {
                        setOrderedIds(ids);
                        orderedIdsRef.current = ids;
                    }}
                >
                    {listItems}
                </Reorder.Group>
            ) : (
                <div className="account-list">{listItems}</div>
            )}
            <button
                type="button"
                className="strip-add-button"
                title="Додати проксі"
                onClick={() => setEditor({ mode: "create" })}
            >
                <Plus size={18} />
                <span>Додати проксі</span>
            </button>
            {editor && (
                <ProxyEditor
                    editor={editor}
                    onClose={() => setEditor(null)}
                    onSave={saveProxy}
                    onCheckConfig={onCheckConfig}
                    onError={onError}
                />
            )}
        </aside>
    );
}
