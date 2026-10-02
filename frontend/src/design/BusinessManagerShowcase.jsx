import BusinessManagerTab from "../tabs/BusinessManagerTab.jsx";
import { businessAssetTasks } from "../../../facebook/api/businessAccess.js";

const accounts = [{ accountKey: "system-demo", name: "Основний системний користувач", kind: "system" }];
const people = [
    { id: "100001", name: "Олександр Коваль", first_name: "Олександр", last_name: "Коваль", email: "alex@example.com", role: "ADMIN", finance_permission: "FINANCE_EDITOR" },
    { id: "100002", name: "Марія Бондар", first_name: "Марія", last_name: "Бондар", email: "maria@example.com", role: "EMPLOYEE", finance_permission: "FINANCE_EDITOR" },
    { id: "100003", name: "Андрій Мельник", first_name: "Андрій", last_name: "Мельник", email: "andrii@example.com", role: "EMPLOYEE", finance_permission: "NONE" },
];
const pages = Array.from({ length: 5 }, (_, index) => ({ id: String(200001 + index), name: ["Daily Stories", "Travel Notes", "Creative Studio", "Healthy Habits", "New Ideas"][index], assignedUsers: people.filter((_, person) => person === 0 || index < 3 - person).map((user) => ({ id: user.id, tasks: user.id === "100003" ? ["ANALYZE"] : businessAssetTasks.pages })) }));
const adAccounts = Array.from({ length: 10 }, (_, index) => ({ id: `act_${300001 + index}`, name: `Campaign Account ${index + 1}`, ownership: index < 7 ? "owned" : "shared", account_status: index < 8 ? 1 : 2, assignedUsers: people.filter((_, person) => person === 0 || index < 7 - person).map((user) => ({ id: user.id, tasks: businessAssetTasks.adAccounts })) }));
const pixels = [{ id: "400001", name: "Main Pixel", ownership: "owned", sharedAccounts: adAccounts.slice(0, 4) }, { id: "400002", name: "Creative Pixel", ownership: "shared", sharedAccounts: adAccounts.slice(0, 2) }];

// Візуальний еталон використовує тільки вигадані дані без робочих API.
if (!window.adsBot) window.adsBot = {
    onBMProgress: () => () => {},
    bmRequest: async (payload) => {
        const data = payload.action === "preferences" ? { accountKey: accounts[0].accountKey, businessId: "500001", section: "users" }
            : payload.action === "list" ? { value: [{ id: "500001", name: "AdsBot · Main Business" }] }
            : payload.action === "section" ? { value: { users: people, pending: [{ id: "100004", email: "new@example.com", role: "EMPLOYEE" }], pages, adAccounts, pixels }, updatedAt: new Date().toISOString() }
            : payload.action === "select" ? true
            : { invited: true, total: 0, successful: 0, people: 0, failed: [], snapshot: { value: { users: people, pages, adAccounts, pixels, pending: [] }, updatedAt: new Date().toISOString() } };
        return { ok: true, data };
    },
};

export default function BusinessManagerShowcase() {
    return <div style={{ padding: 24, height: "100vh", background: "var(--kg-bg)", overflow: "auto" }}><BusinessManagerTab accounts={accounts} /></div>;
}
