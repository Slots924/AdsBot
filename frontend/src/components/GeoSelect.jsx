import SearchSelect from "./SearchSelect.jsx";


export default function GeoSelect({
    countries,
    value,
    onChange,
    disabled = false,
    layout = "grid",
    placeholder = "GEO",
    searchPlaceholder = "Дволітерний код країни…",
    ariaLabel = "GEO",
}) {
    const normalizedValue = String(value ?? "").toUpperCase();
    const items = normalizedValue && !countries.some(
        (country) => country.code === normalizedValue
    )
        ? [{ code: normalizedValue, name: normalizedValue, aliases: [] }, ...countries]
        : countries;
    return (
        <SearchSelect
            className={layout === "list" ? "geo-select geo-select-list" : "geo-select"}
            items={items}
            value={normalizedValue}
            onChange={(code) => onChange(String(code).toUpperCase())}
            getId={(country) => country.code}
            getTitle={(country) => country.code}
            getSubtitle={() => ""}
            getSearchText={(country) => [
                country.code,
                ...(Array.isArray(country.aliases) ? country.aliases : []),
            ].join(" ")}
            placeholder={placeholder}
            searchPlaceholder={searchPlaceholder}
            emptyText="GEO не знайдено"
            ariaLabel={ariaLabel}
            disabled={disabled}
        />
    );
}
