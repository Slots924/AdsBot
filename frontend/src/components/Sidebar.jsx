import { motion } from "framer-motion";
import { Bot, RefreshCw } from "lucide-react";


export default function Sidebar({
    accounts,
    selectedAccountKey,
    loading,
    onSelect,
    onRefresh,
}) {
    return (
        <aside className="sidebar">
            <div className="brand">
                <div className="brand-mark"><Bot size={22} /></div>
                <div>
                    <strong>AdsBot</strong>
                    <span>Control center</span>
                </div>
            </div>

            <div className="sidebar-title-row">
                <div>
                    <span className="eyebrow">Facebook</span>
                    <h2>Акаунти</h2>
                </div>
                <button
                    className="icon-button"
                    onClick={onRefresh}
                    disabled={loading}
                    title="Оновити акаунти"
                >
                    <RefreshCw className={loading ? "spin" : ""} size={17} />
                </button>
            </div>

            <div className="account-list">
                {loading && accounts.length === 0
                    ? [1, 2, 3].map((item) => (
                        <div className="account-card skeleton" key={item} />
                    ))
                    : accounts.map((account, index) => (
                        <motion.button
                            type="button"
                            className={`account-card ${
                                account.accountKey === selectedAccountKey
                                    ? "selected"
                                    : ""
                            }`}
                            key={account.accountKey}
                            onClick={() => onSelect(account.accountKey)}
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.045 }}
                            whileHover={{ x: 3 }}
                        >
                            <span className={`status-dot ${account.status}`} />
                            <span className="account-copy">
                                <strong>{account.accountKey}</strong>
                                <span>{account.name || "Без імені"}</span>
                                <small>{account.facebookUserId || "ID не вказано"}</small>
                                {account.error?.message && (
                                    <em>{account.error.message}</em>
                                )}
                            </span>
                        </motion.button>
                    ))}
            </div>

            <div className="sidebar-legend">
                <span><i className="status-dot active" /> Активний</span>
                <span><i className="status-dot inactive" /> Неактивний</span>
                <span><i className="status-dot error" /> Помилка перевірки</span>
            </div>
        </aside>
    );
}
