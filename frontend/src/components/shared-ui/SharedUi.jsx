import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Trash2, X } from "lucide-react";
import "../../styles/shared-ui.css";

export function UiButton({ variant = "secondary", iconOnly = false, className = "", children, ...props }) {
    return <button type="button" className={`ui-button ${variant} ${iconOnly ? "icon" : ""} ${className}`.trim()} {...props}>{children}</button>;
}

export function UiField({ label, help, children, className = "" }) {
    return <label className={`ui-field ${className}`.trim()}><span className="ui-field-label">{label}</span>{children}{help && <small className="ui-field-help">{help}</small>}</label>;
}

export function UiInput(props) {
    return <input className="ui-input" {...props} />;
}

export function UiTextarea(props) {
    return <textarea className="ui-textarea" {...props} />;
}

export function UiSearch({ value, onChange, placeholder, ariaLabel = placeholder }) {
    return <label className="ui-search"><Search size={16} /><input value={value} onChange={onChange} placeholder={placeholder} aria-label={ariaLabel} /></label>;
}

export function UiSelect({
    items,
    value,
    onChange,
    placeholder = "Оберіть значення",
    searchPlaceholder = "Пошук…",
    emptyText = "Нічого не знайдено.",
    ariaLabel,
    defaultOpen = false,
    disabled = false,
    portal = false,
}) {
    const root = useRef(null);
    const menu = useRef(null);
    const input = useRef(null);
    const listboxId = useId();
    const [open, setOpen] = useState(defaultOpen);
    const [query, setQuery] = useState("");
    const [menuStyle, setMenuStyle] = useState({});
    const selected = items.find((item) => String(item.id) === String(value));
    const visible = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle ? items.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase().includes(needle)) : items;
    }, [items, query]);

    useEffect(() => {
        const close = (event) => {
            if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) {
                setOpen(false);
                setQuery("");
            }
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    useLayoutEffect(() => {
        if (!open || !portal) return undefined;
        const updatePosition = () => {
            const rect = root.current?.getBoundingClientRect();
            if (!rect) return;
            const below = window.innerHeight - rect.bottom - 12;
            const above = rect.top - 12;
            const upwards = below < 180 && above > below;
            const height = Math.max(40, Math.min(250, upwards ? above : below));
            setMenuStyle({
                position: "fixed",
                top: upwards ? "auto" : `${rect.bottom + 6}px`,
                bottom: upwards ? `${window.innerHeight - rect.top + 6}px` : "auto",
                right: "auto",
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                maxHeight: `${height}px`,
            });
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [open, portal]);

    const options = open && !disabled && <div ref={menu} id={listboxId} className={`ui-select-menu ${portal ? "portal" : ""}`} style={portal ? menuStyle : undefined} role="listbox" onMouseDown={(event) => event.stopPropagation()}>
        {visible.length === 0 && <div className="ui-select-empty">{emptyText}</div>}
        {visible.map((item) => <button type="button" role="option" aria-selected={String(item.id) === String(value)} key={item.id} className={`ui-select-option ${String(item.id) === String(value) ? "selected" : ""}`} onClick={() => { onChange(item.id); setQuery(""); setOpen(false); }}>{item.name}</button>)}
    </div>;

    return <div ref={root} className={`ui-select ${open ? "open" : ""}`}>
        <div className={`ui-select-trigger ${disabled ? "disabled" : ""}`}>
            <Search size={16} aria-hidden="true" />
            <input
                ref={input}
                role="combobox"
                aria-label={ariaLabel}
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded={open}
                disabled={disabled}
                value={open ? query : (selected?.name ?? "")}
                placeholder={open ? searchPlaceholder : placeholder}
                onFocus={() => {
                    if (disabled) return;
                    setQuery("");
                    setOpen(true);
                }}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setOpen(false);
                        setQuery("");
                        input.current?.blur();
                    }
                    if (event.key === "Enter" && open && visible[0]) {
                        event.preventDefault();
                        onChange(visible[0].id);
                        setOpen(false);
                        setQuery("");
                    }
                }}
            />
            <button
                type="button"
                className="ui-select-chevron"
                aria-label={open ? "Згорнути список" : "Розгорнути список"}
                disabled={disabled}
                onClick={() => {
                    if (disabled) return;
                    setQuery("");
                    if (open) {
                        setOpen(false);
                        input.current?.blur();
                    } else {
                        setOpen(true);
                        input.current?.focus();
                    }
                }}
            ><ChevronDown size={16} /></button>
        </div>
        {portal ? options && createPortal(options, document.body) : options}
    </div>;
}

export function UiCard({ title, description, children, className = "" }) {
    return <section className={`ui-card ${className}`.trim()}>{(title || description) && <header className="ui-card-header">{title && <h3>{title}</h3>}{description && <p>{description}</p>}</header>}<div className="ui-card-body">{children}</div></section>;
}

export function UiToggle({ enabled, onChange }) {
    return <span className="ui-toggle"><button type="button" className={enabled ? "active" : ""} onClick={() => onChange(true)}>Увімк.</button><button type="button" className={!enabled ? "active off" : ""} onClick={() => onChange(false)}>Вимк.</button></span>;
}

export function UiAssetRow({ name, meta, share = 100, enabled = true, onShareChange, onEnabledChange, onRemove }) {
    return <div className="ui-asset-row"><div className="ui-asset-copy"><strong>{name}</strong><small>{meta}</small></div><label className="ui-share"><input aria-label={`Частка ${name}`} type="number" min="0" max="100" value={share} disabled={!enabled} onChange={(event) => onShareChange?.(Number(event.target.value))} /> %</label><UiToggle enabled={enabled} onChange={(next) => onEnabledChange?.(next)} /><UiButton variant="danger" iconOnly aria-label={`Видалити ${name}`} onClick={onRemove}><Trash2 size={15} /></UiButton></div>;
}

export function UiModal({ title, description, onClose, preview = false, children }) {
    return <div className={`ui-modal-layer ${preview ? "preview" : ""}`} role="dialog" aria-modal={!preview} aria-label={title}><div className="ui-modal"><header className="ui-modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><UiButton iconOnly aria-label="Закрити" onClick={onClose}><X size={18} /></UiButton></header><div className="ui-modal-body">{children}</div></div></div>;
}
