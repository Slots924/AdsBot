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
    onSetArchived,
    onSyncAccount,
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
    onReorderProxies,
    onError,
}) {
    return (
        <section className="accounts-tab">
            <div className="accounts-workspace">
                <Sidebar
                    standalone
                    accounts={accounts}
                    selectedAccountKey={selectedAccountKey}
                    loading={accountsLoading}
                    onSelect={onSelectAccount}
                    onRefresh={onRefreshAccounts}
                    onCreate={onCreateAccount}
                    onUpdate={onUpdateAccount}
                    onSetArchived={onSetArchived}
                    onSync={onSyncAccount}
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
                    onReorder={onReorderProxies}
                    onError={onError}
                />
            </div>
        </section>
    );
}
