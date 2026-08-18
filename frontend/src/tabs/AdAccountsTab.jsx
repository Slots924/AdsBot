import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, ShieldAlert } from "lucide-react";

import SearchSelect from "../components/SearchSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


function value(value) {
    return value === null || value === undefined || value === "" ? "—" : value;
}


export default function AdAccountsTab({ selectedAccount, onError }) {
    const [accounts, setAccounts] = useState([]);
    const [selectedId, setSelectedId] = useState("");
    const [loading, setLoading] = useState(false);
    const accountActive = selectedAccount?.status === "active";
    const selected = accounts.find((account) => account.id === selectedId);

    const load = async () => {
        if (!accountActive) return;
        setLoading(true);
        try {
            const nextAccounts = await unwrap(
                window.adsBot.getAdAccounts(selectedAccount.accountKey)
            );
            setAccounts(nextAccounts);
            setSelectedId("");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити РК" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setAccounts([]);
        setSelectedId("");
        load();
    }, [selectedAccount?.accountKey, accountActive]);

    return (
        <motion.section className="tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="page-heading split">
                <div>
                    <span className="eyebrow">Meta Ads</span>
                    <h1>Рекламні акаунти</h1>
                    <p>Read-only інформація для вибраного Facebook-профілю.</p>
                </div>
                <button className="secondary-button" disabled={!accountActive || loading} onClick={load}>
                    <RefreshCw className={loading ? "spin" : ""} size={16} /> Оновити РК
                </button>
            </div>

            {!accountActive && (
                <div className="notice danger"><ShieldAlert size={17} /> Оберіть активний Facebook-акаунт.</div>
            )}

            <div className="form-card compact">
                <SearchSelect
                    items={accounts}
                    value={selectedId}
                    onChange={setSelectedId}
                    getTitle={(account) => account.name}
                    getSubtitle={(account) => `${account.accountId} · ${account.status}`}
                    placeholder={loading ? "Завантажуємо РК…" : "Оберіть рекламний акаунт"}
                    searchPlaceholder="Назва, Account ID або Graph ID…"
                    disabled={!accountActive || loading}
                />
            </div>

            {selected && (
                <motion.div className="ad-detail" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }}>
                    <header>
                        <div>
                            <span className={`status-pill ${selected.status}`}>{selected.status}</span>
                            <h2>{selected.name}</h2>
                            <p>{selected.accountId} · {selected.id}</p>
                        </div>
                        {selected.status !== "active" && (
                            <div className="reason-card">
                                <span>Причина Meta #{value(selected.disableReason?.code)}</span>
                                <strong>{selected.disableReason?.label}</strong>
                            </div>
                        )}
                    </header>
                    <div className="detail-grid">
                        <div><span>Business</span><strong>{value(selected.business?.name)}</strong><small>{value(selected.business?.id)}</small></div>
                        <div><span>Owner</span><strong>{value(selected.owner)}</strong></div>
                        <div><span>Валюта</span><strong>{value(selected.currency)}</strong></div>
                        <div><span>Часовий пояс</span><strong>{value(selected.timezoneName)}</strong></div>
                        <div><span>Витрачено</span><strong>{value(selected.amountSpent)}</strong></div>
                        <div><span>Баланс</span><strong>{value(selected.balance)}</strong></div>
                        <div><span>Spend cap</span><strong>{value(selected.spendCap)}</strong></div>
                        <div><span>Створено</span><strong>{value(selected.createdTime)}</strong></div>
                    </div>
                </motion.div>
            )}
        </motion.section>
    );
}
