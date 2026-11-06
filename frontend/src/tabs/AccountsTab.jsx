import Sidebar from "../components/Sidebar.jsx";
import ProxyStrip from "../components/ProxyStrip.jsx";


export default function AccountsTab({
    accounts,
    selectedAccountKey,
    accountsLoading,
    onSelectAccount,
    onRefreshAccounts,
    onCreateAccount,
    onUpdateAccount,
    onDeleteAccount,
    onCheckAccount,
    onSetPrimaryAccount,
    onOpenPersonalAccount,
    onSyncAccount,
    onRefreshAccessToken,
    refreshingTokenAccountKeys = [],
    onOpenAccountProfile,
    onCloseAccountProfile,
    syncingAccountKeys = [],
    proxies,
    proxiesLoading,
    onCreateProxy,
    onUpdateProxy,
    onDeleteProxy,
    onGetProxy,
    onCheckProxy,
    onCheckProxyConfig,
    onRefreshProxyIp,
    onSyncProxy,
    onReorderProxies,
    onRefreshProxies,
    onError,
}) {
    return (
        <section className="connections-page">
            <header className="connections-page-heading"><div><span className="eyebrow">Підключення</span><h1>API-клієнти та проксі</h1></div><span className="connections-summary">Клієнтів: {accounts.length} · проксі: {proxies.length}</span></header>
            <div className="accounts-workspace">
                <Sidebar
                    standalone
                    accounts={accounts}
                    proxies={proxies}
                    selectedAccountKey={selectedAccountKey}
                    loading={accountsLoading}
                    onSelect={onSelectAccount}
                    onRefresh={onRefreshAccounts}
                    onCreate={onCreateAccount}
                    onUpdate={onUpdateAccount}
                    onDelete={onDeleteAccount}
                    onCheck={onCheckAccount}
                    onSetPrimary={onSetPrimaryAccount}
                    onOpenPersonalAccount={onOpenPersonalAccount}
                    onSync={onSyncAccount}
                    onRefreshAccessToken={onRefreshAccessToken}
                    refreshingTokenAccountKeys={refreshingTokenAccountKeys}
                    onOpenProfile={onOpenAccountProfile}
                    onCloseProfile={onCloseAccountProfile}
                    syncingAccountKeys={syncingAccountKeys}
                    onError={onError}
                />
                <ProxyStrip
                    proxies={proxies}
                    loading={proxiesLoading}
                    onCreate={onCreateProxy}
                    onUpdate={onUpdateProxy}
                    onDelete={onDeleteProxy}
                    onGet={onGetProxy}
                    onCheck={onCheckProxy}
                    onCheckConfig={onCheckProxyConfig}
                    onRefreshIp={onRefreshProxyIp}
                    onSync={onSyncProxy}
                    onReorder={onReorderProxies}
                    onRefresh={onRefreshProxies}
                    onError={onError}
                />
            </div>
        </section>
    );
}
