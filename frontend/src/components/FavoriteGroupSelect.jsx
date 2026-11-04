import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import SearchSelect from "./SearchSelect.jsx";

export default function FavoriteGroupSelect({ groups, value, onChange, storageKey, defaultName, disabled, ariaLabel }) {
    const [favorite, setFavorite] = useState(() => localStorage.getItem(storageKey) || "");
    const getId = item => String(item.groupId ?? item.id);
    const getName = item => item.groupName ?? item.name;
    const normalizeName = name => String(name).replace(/[^a-z0-9]/gi, "").toLowerCase().replace(/n(?=\d)/g, "");
    useEffect(() => {
        if (value || !groups.length) return;
        const preferred = groups.find(item => getId(item) === favorite)
            || groups.find(item => normalizeName(getName(item)) === normalizeName(defaultName));
        if (preferred) {
            onChange(getId(preferred));
            if (!favorite && localStorage.getItem(storageKey) === null) {
                setFavorite(getId(preferred)); localStorage.setItem(storageKey, getId(preferred));
            }
        }
    }, [groups, favorite, value, defaultName, onChange]);
    return <SearchSelect items={groups} value={value} onChange={onChange} getId={getId} getTitle={getName}
        getSubtitle={() => ""} disabled={disabled} ariaLabel={ariaLabel} placeholder="Оберіть групу"
        renderOptionAction={item => <button type="button" className="icon-button" title="Група за замовчуванням"
            aria-label={`Обрати групу ${getName(item)} за замовчуванням`} aria-pressed={favorite === getId(item)}
            onClick={() => { const next = favorite === getId(item) ? "" : getId(item); setFavorite(next); localStorage.setItem(storageKey, next); }}>
            <Star size={15} fill={favorite === getId(item) ? "currentColor" : "none"} /></button>} />;
}
