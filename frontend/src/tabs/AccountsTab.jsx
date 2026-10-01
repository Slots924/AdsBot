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
    onError,
}) {
    return (
        <section className="accounts-tab">
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
                    onError={onError}
                />
            </div>
        </section>
    );
}
