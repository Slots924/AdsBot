import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";


export default function MultiSelect({
    items,
    value,
    onChange,
    disabled = false,
    placeholder = "Оберіть акаунти",
    searchPlaceholder = "Назва або ID акаунта…",
}) {
    const root = useRef(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const normalizedValue = value.map(String);
    const selectedSet = new Set(normalizedValue);
    const filtered = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle
            ? items.filter((group) => (
                `${group.groupName} ${group.groupId}`
                    .toLocaleLowerCase()
                    .includes(needle)
            ))
            : items;
    }, [items, query]);

    useEffect(() => {
        const close = (event) => {
            if (!root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const toggle = (rawGroupId) => {
        const groupId = String(rawGroupId);
        onChange(selectedSet.has(groupId)
            ? normalizedValue.filter((id) => id !== groupId)
            : [...normalizedValue, groupId]);
    };

    return (
        <div ref={root} className={`select multi-select ${open ? "open" : ""}`}>
            <button
                type="button"
                className="select-trigger"
                disabled={disabled}
                aria-label="Акаунти для коментарів"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <span>
                    <strong>{value.length ? `Вибрано: ${value.length}` : placeholder}</strong>
                    <small>Можна вибрати декілька</small>
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
                            <div className="select-empty">Акаунтів не знайдено</div>
                        )}
                        {filtered.map((group) => {
                            const groupId = String(group.groupId);
                            return (
                                <button
                                    type="button"
                                    className="select-option"
                                    key={groupId}
                                    onClick={() => toggle(groupId)}
                                >
                                    <span>
                                        <strong>{group.groupName || "Без назви"}</strong>
                                        <small>ID {groupId}</small>
                                    </span>
                                    <i className={`checkbox ${selectedSet.has(groupId) ? "checked" : ""}`}>
                                        {selectedSet.has(groupId) && <Check size={13} />}
                                    </i>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {value.length > 0 && (
                <div className="chips">
                    {normalizedValue.map((groupId) => {
                        const group = items.find((item) => String(item.groupId) === groupId);
                        return (
                            <span className="chip" key={groupId}>
                                {group?.groupName || groupId}
                                <button type="button" onClick={() => toggle(groupId)}>
                                    <X size={12} />
                                </button>
                            </span>
                        );
                    })}
                    <button className="clear-selection" type="button" onClick={() => onChange([])}>
                        <X size={13} /> Очистити все
                    </button>
                </div>
            )}
        </div>
    );
}
