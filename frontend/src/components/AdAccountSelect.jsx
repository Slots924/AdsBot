import SearchSelect from "./SearchSelect.jsx";


export function sortAdAccounts(accounts = []) {
    return accounts.slice().sort((left, right) => {
        const statusOrder = Number(right.status === "active")
            - Number(left.status === "active");
        return statusOrder || String(left.id).localeCompare(String(right.id), "uk-UA", {
            numeric: true,
            sensitivity: "base",
        });
    });
}


export default function AdAccountSelect({ accounts, value, onChange, disabled }) {
    return (
        <SearchSelect
            className="ad-account-select"
            items={sortAdAccounts(accounts)}
            value={value}
            onChange={onChange}
            getId={(account) => account.id}
            getTitle={(account) => account.id}
            getSubtitle={() => ""}
            getSearchText={(account) => account.id}
            getStatus={(account) => account.status === "active" ? "active" : "inactive"}
            placeholder="Оберіть ID рекламного акаунта"
            searchPlaceholder="Пошук лише за ID…"
            emptyText="Рекламний акаунт не знайдено"
            ariaLabel="Рекламний акаунт"
            disabled={disabled}
        />
    );
}
