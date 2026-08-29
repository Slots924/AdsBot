import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";


export default function SearchSelect({
    items,
    value,
    onChange,
    getId = (item) => item.id,
    getTitle = (item) => item.name,
    getSubtitle = (item) => item.id,
    getSearchText,
    getStatus,
    multiple = false,
    placeholder = "Оберіть значення",
    searchPlaceholder = "Пошук…",
    emptyText = "Нічого не знайдено",
    disabled = false,
    ariaLabel,
    className = "",
}) {
    const root = useRef(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selectedItems = multiple
        ? items.filter((item) => (Array.isArray(value) ? value : [])
            .some((itemId) => String(getId(item)) === String(itemId)))
        : [];
    const selected = multiple
        ? null
        : items.find((item) => String(getId(item)) === String(value));
    const filtered = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return items;
        return items.filter((item) => String(
            getSearchText
                ? getSearchText(item)
                : `${getTitle(item)} ${getSubtitle(item)}`
        ).toLocaleLowerCase().includes(needle));
    }, [items, query, getTitle, getSubtitle, getSearchText]);

    useEffect(() => {
        const close = (event) => {
            if (!root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const subtitle = selected ? getSubtitle(selected) : "";
    return (
        <div ref={root} className={`select ${open ? "open" : ""} ${className}`.trim()}>
            <button
                type="button"
                className="select-trigger"
                aria-label={ariaLabel}
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span className="select-trigger-value">
                    {!multiple && selected && getStatus && (
                        <i className={`select-status status-dot ${getStatus(selected)}`} />
                    )}
                    <span>
                        <strong>{multiple
                            ? (selectedItems.length ? `${selectedItems.length} вибрано` : placeholder)
                            : (selected ? getTitle(selected) : placeholder)}</strong>
                        {multiple
                            ? selectedItems.length > 0 && <small>{selectedItems.map(getTitle).join(", ")}</small>
                            : subtitle && <small>{subtitle}</small>}
                    </span>
                </span>
                <ChevronDown size={17} />
            </button>

            {open && !disabled && (
                <div className="select-menu">
                    <label className="select-search">
                        <Search size={16} />
                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={searchPlaceholder}
                        />
                    </label>
                    <div className="select-options">
                        {filtered.length === 0 && (
                            <div className="select-empty">{emptyText}</div>
                        )}
                        {filtered.map((item) => {
                            const id = getId(item);
                            const optionSubtitle = getSubtitle(item);
                            return (
                                <button
                                    type="button"
                                    className="select-option"
                                    key={id}
                                    onClick={() => {
                                        if (multiple) {
                                            const current = Array.isArray(value) ? value : [];
                                            onChange(current.some((itemId) => String(itemId) === String(id))
                                                ? current.filter((itemId) => String(itemId) !== String(id))
                                                : [...current, id]);
                                            return;
                                        }
                                        onChange(id);
                                        setOpen(false);
                                        setQuery("");
                                    }}
                                >
                                    <span className="select-option-value">
                                        {getStatus && (
                                            <i className={`select-status status-dot ${getStatus(item)}`} />
                                        )}
                                        <span>
                                            <strong>{getTitle(item)}</strong>
                                            {optionSubtitle && <small>{optionSubtitle}</small>}
                                        </span>
                                    </span>
                                    {(multiple
                                        ? (Array.isArray(value) && value.some((itemId) => String(itemId) === String(id)))
                                        : String(id) === String(value)) && <Check size={16} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
