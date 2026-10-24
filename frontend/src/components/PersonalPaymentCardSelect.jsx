import { useState } from "react";
import { Plus } from "lucide-react";
import SearchSelect from "./SearchSelect.jsx";
import CreditCardsSettings from "./CreditCardsSettings.jsx";

export default function PersonalPaymentCardSelect({ cards, value, onChange, onCreated, disabled, onError, showToast }) {
    const [creating, setCreating] = useState(false);
    return <div className="personal-payment-card-picker">
        <div className="personal-payment-card-label">Кредитна картка</div>
        <div className="personal-payment-card-row">
            <SearchSelect className="personal-payment-card-select" items={cards} value={value}
                onChange={onChange} disabled={disabled} ariaLabel="Кредитна картка"
                getTitle={(card) => card.nickname.toUpperCase()}
                getSubtitle={(card) => `${card.network} •••• ${card.last4} · ${card.cardholderName} · ${card.expiration}`}
                getSearchText={(card) => `${card.nickname} ${card.cardholderName} ${card.network} ${card.last4}`}
                placeholder="Оберіть картку" searchPlaceholder="Назва, власник або останні 4 цифри…"
                emptyText="Карток не знайдено" />
            <button type="button" className="secondary-button personal-payment-card-add" aria-label="Додати нову картку"
                title="Додати нову картку" disabled={disabled || creating} onClick={() => setCreating(true)}><Plus size={20} /></button>
        </div>
        {creating && <CreditCardsSettings editorOnly onError={onError} showToast={showToast}
            onCancel={() => setCreating(false)} onSaved={(card) => { onCreated(card); onChange(card.id); setCreating(false); }} />}
    </div>;
}
