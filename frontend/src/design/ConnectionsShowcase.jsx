import { useState } from "react";
import AccountsTab from "../tabs/AccountsTab.jsx";

// Лише вигадані дані: перегляд дизайну не звертається до робочих API.
const initialAccounts = ["Atlas US", "Orion PL", "Nova DE", "Horizon FR", "Studio IT", "North SE", "West ES", "Business Studio", "System Studio"].map((name, index) => ({
    accountKey: `demo-${index}`, name, kind: index === 7 ? "bm" : index === 8 ? "system" : "api",
    facebookUserId: `10000000000000000${index}`, adsPowerProfileNo: String(340 + index),
    status: index === 1 ? "inactive" : "active", tokenMode: "access", hasAccessToken: true,
    hasCookie: true, hasUserAgent: true, hasAfpToken: true,
    error: index === 1 ? { message: "Не вдалося перевірити токен" } : null,
}));
const initialProxies = Array.from({ length: 6 }, (_, index) => ({ id: `proxy-demo-${index}`, name: `Proxy ${index + 1}`, type: "socks5", adsPowerId: index + 1, isPublic: index !== 2, hasRefreshUrl: true }));
const done = async () => ({});
if (!window.adsBot) window.adsBot = { getAccountEditorCredentials: async () => ({ ok: true, data: { accessToken: "", userAgent: "", cookie: "" } }) };

export default function ConnectionsShowcase() {
    const [accounts, setAccounts] = useState(initialAccounts);
    const [proxies, setProxies] = useState(initialProxies);
    const [selected, setSelected] = useState("demo-0");
    return <div className="accounts-tab" style={{ height: "100dvh" }}><AccountsTab
        accounts={accounts} proxies={proxies} selectedAccountKey={selected} onSelectAccount={setSelected}
        onRefreshAccounts={done} onRefreshProxies={done} onCheckAccount={done} onSyncAccount={done}
        onRefreshAccessToken={done} onOpenAccountProfile={done} onCloseAccountProfile={done}
        onUpdateAccount={async (key, patch) => setAccounts((items) => items.map((item) => item.accountKey === key ? { ...item, ...patch } : item))}
        onCreateAccount={async (draft) => setAccounts((items) => [...items, { ...draft, accountKey: `demo-${items.length}` }])}
        onDeleteAccount={async (key) => setAccounts((items) => items.filter((item) => item.accountKey !== key))}
        onSetPrimaryAccount={done} onOpenPersonalAccount={done}
        onUpdateProxy={async (id, patch) => setProxies((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))}
        onCreateProxy={async (draft) => setProxies((items) => [...items, { ...draft, id: `proxy-demo-${items.length}` }])}
        onDeleteProxy={async (id) => setProxies((items) => items.filter((item) => item.id !== id))}
        onGetProxy={async (id) => proxies.find((item) => item.id === id)} onCheckProxy={done}
        onCheckProxyConfig={done} onRefreshProxyIp={done} onSyncProxy={done} onReorderProxies={done} onError={done}
    /></div>;
}
