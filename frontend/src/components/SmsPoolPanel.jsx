import { useEffect, useMemo, useState } from "react";
import {
    Clock3,
    LoaderCircle,
    MessageSquareText,
    RefreshCw,
    RotateCcw,
    Square,
    WalletCards,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import SearchSelect from "./SearchSelect.jsx";


const runningStatuses = new Set(["running", "stopping"]);


function formatBalance(value) {
    return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "—";
}


function statusLabel(job) {
    if (!job) return "Немає активного замовлення";
    if (job.status === "completed") return "Підтверджено";
    if (job.status === "failed") return "Не вдалося";
    if (job.status === "stopped") return "Зупинено";
    if (job.status === "stopping") return "Зупиняємо";
    return "Активне замовлення";
}


export default function SmsPoolPanel({
    sessionId,
    adAccountId,
    dashboard,
    onDashboard,
    onOrderChange,
    onError,
    showToast,
}) {
    const [countryId, setCountryId] = useState("");
    const [maxAttempts, setMaxAttempts] = useState(5);
    const [waitSeconds, setWaitSeconds] = useState(60);
    const [action, setAction] = useState("");
    const job = dashboard?.job ?? null;
    const isRunning = runningStatuses.has(job?.status);
    const countries = dashboard?.countries ?? [];

    useEffect(() => {
        if (countryId || !countries.length) return;
        const defaultCountry = countries.find((item) => item.iso === "US") ?? countries[0];
        setCountryId(defaultCountry?.id ?? "");
    }, [countries, countryId]);

    useEffect(() => {
        if (!sessionId) return undefined;
        let disposed = false;
        const refresh = async (full = false) => {
            try {
                const next = await unwrap(full
                    ? window.adsBot.getPersonalSmsPoolDashboard(sessionId)
                    : window.adsBot.getPersonalSmsPoolState(sessionId));
                if (disposed) return;
                onDashboard((current) => ({ ...current, ...next }));
                onOrderChange?.(next.job);
            } catch {}
        };
        void refresh(true);
        const timer = window.setInterval(() => void refresh(false), 1000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [sessionId, onDashboard, onOrderChange]);

    const selectedCountry = useMemo(
        () => countries.find((item) => String(item.id) === String(countryId)) ?? null,
        [countries, countryId]
    );

    const perform = async (name, operation, successMessage = "") => {
        if (action) return;
        setAction(name);
        try {
            const nextJob = await unwrap(operation());
            onDashboard((current) => ({ ...current, job: nextJob }));
            onOrderChange?.(nextJob);
            if (successMessage) showToast?.(successMessage, "success");
        } catch (error) {
            onError({ ...errorDetails(error), title: "SMSPool: не вдалося виконати дію" });
        } finally {
            setAction("");
        }
    };

    const history = dashboard?.history ?? [];
    return <div className="sms-pool-panel">
        <div className="sms-pool-panel-head">
            <div>
                <span className="eyebrow">SMSPool · Quick purchase</span>
                <h4>Автоматичне SMS-підтвердження</h4>
                <p>Сервіс: <strong>{dashboard?.service ?? "Facebook / Meta Viewpoints"}</strong></p>
            </div>
            <div className="sms-pool-balance"><WalletCards size={18} /><span>Баланс<strong>{formatBalance(dashboard?.balance)}</strong></span></div>
        </div>

        {dashboard?.warning && <div className="sms-pool-warning">{dashboard.warning}</div>}

        <div className="sms-pool-order-form">
            <label className="field sms-pool-country"><span>Країна</span><SearchSelect
                items={countries}
                value={countryId}
                onChange={setCountryId}
                getTitle={(item) => item.name}
                getSubtitle={(item) => `${item.iso}${item.dialingCode ? ` · +${item.dialingCode}` : ""}`}
                getSearchText={(item) => `${item.name} ${item.iso} ${item.dialingCode}`}
                placeholder="Оберіть країну"
                searchPlaceholder="Пошук країни…"
                disabled={isRunning || Boolean(action)}
                ariaLabel="Країна SMSPool"
            /></label>
            <label className="field"><span>Кількість спроб</span><input type="number" min="1" max="20" value={maxAttempts} disabled={isRunning} onChange={(event) => setMaxAttempts(event.target.value)} /></label>
            <label className="field"><span>Очікування, с</span><input type="number" min="15" max="300" value={waitSeconds} disabled={isRunning} onChange={(event) => setWaitSeconds(event.target.value)} /></label>
            {!isRunning ? <button type="button" className="sms-pool-purchase" disabled={!sessionId || !adAccountId || !selectedCountry || Boolean(action)} onClick={() => perform("start", () => window.adsBot.startPersonalSmsPoolVerification(sessionId, { adAccountId, countryId, maxAttempts, waitSeconds }), "Автоматичне SMS-підтвердження запущено")}>{action === "start" ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />} Швидке замовлення</button> : <button type="button" className="danger-button" disabled={Boolean(action)} onClick={() => perform("stop", () => window.adsBot.stopPersonalSmsPoolVerification(sessionId), "Автоматичне підтвердження зупинено")}>{action === "stop" ? <LoaderCircle className="spin" size={17} /> : <Square size={15} />} Стоп</button>}
        </div>

        <div className={`sms-pool-active${isRunning ? " running" : ""}`}>
            <div className="sms-pool-active-title"><span><i /> {statusLabel(job)}</span>{job && <strong>Спроба {job.attempt} з {job.maxAttempts}</strong>}</div>
            {job ? <div className="sms-pool-active-grid">
                <div><small>Номер телефону</small><strong>{job.order?.phone || "Отримуємо номер…"}</strong></div>
                <div><small>Код</small><strong className="sms-pool-code">{job.order?.code || (isRunning ? <><LoaderCircle className="spin" size={15} /> Очікуємо SMS</> : "—")}</strong></div>
                <div><small>Залишилось</small><strong><Clock3 size={15} /> {job.secondsLeft} с</strong></div>
                <div><small>Статус</small><strong>{job.message}</strong></div>
            </div> : <p className="sms-pool-empty">Після швидкого замовлення активний номер з’явиться тут.</p>}
        </div>

        <div className="sms-pool-history">
            <div className="sms-pool-history-head"><div><h4>Останні успішні номери</h4><p>Показано до 5 останніх підтверджень.</p></div><button type="button" className="icon-button" title="Оновити SMSPool" disabled={Boolean(action)} onClick={async () => {
                setAction("refresh");
                try {
                    onDashboard(await unwrap(window.adsBot.getPersonalSmsPoolDashboard(sessionId)));
                } catch (error) {
                    onError({ ...errorDetails(error), title: "Не вдалося оновити SMSPool" });
                } finally {
                    setAction("");
                }
            }}><RefreshCw className={action === "refresh" ? "spin" : ""} size={16} /></button></div>
            <div className="sms-pool-table-wrap"><table className="sms-pool-table"><thead><tr><th>Номер</th><th>Код</th><th>Країна</th><th>Вартість</th><th>Дії</th></tr></thead><tbody>{history.map((item) => <tr key={item.orderId}><td>{item.phone}</td><td><span className="sms-pool-completed">{item.code}</span></td><td>{item.country || "—"}</td><td>{item.cost ? `$${item.cost}` : "—"}</td><td><button type="button" className="sms-pool-resend" disabled={!sessionId || !adAccountId || isRunning || Boolean(action)} onClick={() => perform(`resend:${item.orderId}`, () => window.adsBot.resendPersonalSmsPoolVerification(sessionId, { orderId: item.orderId, adAccountId, waitSeconds }), "Повторне SMS запущено")}><RotateCcw size={14} /> Resend</button></td></tr>)}{!history.length && <tr><td colSpan="5" className="sms-pool-empty">Успішних замовлень ще немає.</td></tr>}</tbody></table></div>
        </div>
    </div>;
}
