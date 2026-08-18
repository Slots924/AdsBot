import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";


export default function MultiSelect({
    items,
    value,
    onChange,
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selectedSet = new Set(value);
    const filtered = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle
            ? items.filter((group) =>
                `${group.groupName} ${group.groupId}`
                    .toLocaleLowerCase()
                    .includes(needle)
            )
            : items;
    }, [items, query]);

    const toggle = (groupId) => {
        onChange(selectedSet.has(groupId)
            ? value.filter((id) => id !== groupId)
            : [...value, groupId]);
    };

    return (
        <div className={`select multi-select ${open ? "open" : ""}`}>
            <button
                type="button"
                className="select-trigger"
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span>
                    <strong>{value.length ? `Вибрано груп: ${value.length}` : "Оберіть групи"}</strong>
                    <small>Можна вибрати декілька</small>
                </span>
                <ChevronDown size={17} />
            </button>

            {open && !disabled && (
                <div className="select-menu">
                    <label className="select-search">
                        <Search size={15} />
                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Назва або ID групи…"
                        />
                    </label>
                    <div className="select-options">
                        {filtered.map((group) => (
                            <button
                                type="button"
                                className="select-option"
                                key={group.groupId}
                                onClick={() => toggle(group.groupId)}
                            >
                                <span>
                                    <strong>{group.groupName || "Без назви"}</strong>
                                    <small>ID {group.groupId}</small>
                                </span>
                                <i className={`checkbox ${selectedSet.has(group.groupId) ? "checked" : ""}`}>
                                    {selectedSet.has(group.groupId) && <Check size={13} />}
                                </i>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {value.length > 0 && (
                <div className="chips">
                    {value.map((groupId) => {
                        const group = items.find((item) => item.groupId === groupId);
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
