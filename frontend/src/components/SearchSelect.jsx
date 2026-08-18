import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";


export default function SearchSelect({
    items,
    value,
    onChange,
    getId = (item) => item.id,
    getTitle = (item) => item.name,
    getSubtitle = (item) => item.id,
    placeholder = "Оберіть значення",
    searchPlaceholder = "Пошук…",
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = items.find((item) => getId(item) === value);
    const filtered = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return needle
            ? items.filter((item) =>
                `${getTitle(item)} ${getSubtitle(item)}`
                    .toLocaleLowerCase()
                    .includes(needle)
            )
            : items;
    }, [items, query, getTitle, getSubtitle]);

    return (
        <div className={`select ${open ? "open" : ""}`}>
            <button
                type="button"
                className="select-trigger"
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span>
                    <strong>{selected ? getTitle(selected) : placeholder}</strong>
                    {selected && <small>{getSubtitle(selected)}</small>}
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
                            placeholder={searchPlaceholder}
                        />
                    </label>
                    <div className="select-options">
                        {filtered.length === 0 && (
                            <div className="select-empty">Нічого не знайдено</div>
                        )}
                        {filtered.map((item) => {
                            const id = getId(item);
                            return (
                                <button
                                    type="button"
                                    className="select-option"
                                    key={id}
                                    onClick={() => {
                                        onChange(id);
                                        setOpen(false);
                                        setQuery("");
                                    }}
                                >
                                    <span>
                                        <strong>{getTitle(item)}</strong>
                                        <small>{getSubtitle(item)}</small>
                                    </span>
                                    {id === value && <Check size={16} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
