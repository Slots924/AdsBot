import SearchSelect from "./SearchSelect.jsx";


export default function GeoSelect({ countries, value, onChange, disabled = false }) {
    const normalizedValue = String(value ?? "").toUpperCase();
    const items = normalizedValue && !countries.some(
        (country) => country.code === normalizedValue
    )
        ? [{ code: normalizedValue, name: normalizedValue }, ...countries]
        : countries;
    return (
        <SearchSelect
            className="geo-select"
            items={items}
            value={normalizedValue}
            onChange={(code) => onChange(String(code).toUpperCase())}
            getId={(country) => country.code}
            getTitle={(country) => country.code}
            getSubtitle={() => ""}
            getSearchText={(country) => [
                country.code,
                country.name,
                ...(country.aliases ?? []),
            ].join(" ")}
            placeholder="GEO"
            searchPlaceholder="Код або назва країни…"
            emptyText="GEO не знайдено"
            ariaLabel="GEO"
            disabled={disabled}
        />
    );
}
