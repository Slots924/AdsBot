import { useEffect, useState } from "react";

const notices = {
    LINKED: ["green", "Телефон прив’язаний"],
    NOT_LINKED: ["red", "Телефон не прив’язаний"],
    UNKNOWN: ["yellow", "Не вдалося з’ясувати"],
};

export default function PhoneVerificationNotice({ result }) {
    const [visibleResult, setVisibleResult] = useState(null);
    useEffect(() => {
        const remaining = result ? Math.max(0, (result.expiresAt ?? Date.now() + 5000) - Date.now()) : 0;
        setVisibleResult(remaining ? result : null);
        if (!remaining) return;
        const timer = setTimeout(() => setVisibleResult(null), remaining);
        return () => clearTimeout(timer);
    }, [result]);
    const [color, message] = notices[visibleResult?.phoneStatus] ?? notices.UNKNOWN;
    return <div className="phone-verification-notice-slot" role="status" aria-live="polite">
        {visibleResult && <div className={`phone-verification-notice ${color}`}>{message}</div>}
    </div>;
}
