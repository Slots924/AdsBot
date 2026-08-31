import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Trash2, X } from "lucide-react";
import "../../styles/keitaro-gray.css";

export function GrayButton({ variant = "secondary", iconOnly = false, className = "", children, ...props }) {
    return <button type="button" className={`kg-button ${variant} ${iconOnly ? "icon" : ""} ${className}`.trim()} {...props}>{children}</button>;
}

export function GrayField({ label, help, children, className = "" }) {
    return <label className={`kg-field ${className}`.trim()}><span className="kg-field-label">{label}</span>{children}{help && <small className="kg-field-help">{help}</small>}</label>;
}

export function GrayInput(props) {
    return <input className="kg-input" {...props} />;
}

export function GrayTextarea(props) {
    return <textarea className="kg-textarea" {...props} />;
}

export function GraySearch({ value, onChange, placeholder, ariaLabel = placeholder }) {
    return <label className="kg-search"><Search size={16} /><input value={value} onChange={onChange} placeholder={placeholder} aria-label={ariaLabel} /></label>;
}

export function GraySelect({ items, value, onChange, placeholder = "Оберіть значення", ariaLabel, defaultOpen = false }) {
    const root = useRef(null);
    const [open, setOpen] = useState(defaultOpen);
    const [query, setQuery] = useState("");
    const selected = items.find((item) => String(item.id) === String(value));
    const visible = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle ? items.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase().includes(needle)) : items;
    }, [items, query]);

    useEffect(() => {
        const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    return <div ref={root} className={`kg-select ${open ? "open" : ""}`}>
        <button type="button" className="kg-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.name ?? placeholder}</span><ChevronDown size={16} /></button>
        {open && <div className="kg-select-menu" role="listbox">
            <GraySearch value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук…" ariaLabel={`Пошук: ${ariaLabel ?? placeholder}`} />
            {visible.length === 0 && <div className="kg-select-empty">Нічого не знайдено.</div>}
            {visible.map((item) => <button type="button" role="option" aria-selected={String(item.id) === String(value)} key={item.id} className={`kg-select-option ${String(item.id) === String(value) ? "selected" : ""}`} onClick={() => { onChange(item.id); setQuery(""); setOpen(false); }}>{item.name}</button>)}
        </div>}
    </div>;
}

export function GrayCard({ title, description, children, className = "" }) {
    return <section className={`kg-card ${className}`.trim()}>{(title || description) && <header className="kg-card-header">{title && <h3>{title}</h3>}{description && <p>{description}</p>}</header>}<div className="kg-card-body">{children}</div></section>;
}

export function GrayToggle({ enabled, onChange }) {
    return <span className="kg-toggle"><button type="button" className={enabled ? "active" : ""} onClick={() => onChange(true)}>Увімк.</button><button type="button" className={!enabled ? "active off" : ""} onClick={() => onChange(false)}>Вимк.</button></span>;
}

export function GrayAssetRow({ name, meta, share = 100, enabled = true, onShareChange, onEnabledChange, onRemove }) {
    return <div className="kg-asset-row"><div className="kg-asset-copy"><strong>{name}</strong><small>{meta}</small></div><label className="kg-share"><input aria-label={`Частка ${name}`} type="number" min="0" max="100" value={share} disabled={!enabled} onChange={(event) => onShareChange?.(Number(event.target.value))} /> %</label><GrayToggle enabled={enabled} onChange={(next) => onEnabledChange?.(next)} /><GrayButton variant="danger" iconOnly aria-label={`Видалити ${name}`} onClick={onRemove}><Trash2 size={15} /></GrayButton></div>;
}

export function GrayModal({ title, description, onClose, preview = false, children }) {
    return <div className={`kg-modal-layer ${preview ? "preview" : ""}`} role="dialog" aria-modal={!preview} aria-label={title}><div className="kg-modal"><header className="kg-modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><GrayButton iconOnly aria-label="Закрити" onClick={onClose}><X size={18} /></GrayButton></header><div className="kg-modal-body">{children}</div></div></div>;
}
