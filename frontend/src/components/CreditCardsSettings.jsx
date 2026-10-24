import { useEffect, useState } from "react";
import { CreditCard, Pencil, Plus, Trash2, X } from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const blankCard = () => ({
    id: "",
    nickname: "",
    cardholderName: "",
    cardNumber: "",
    securityCode: "",
    expiration: "",
    postalCode: "",
    countryCode: "US",
});


export default function CreditCardsSettings({ onError = () => {}, showToast, editorOnly = false, onSaved, onCancel }) {
    const [cards, setCards] = useState([]);
    const [editor, setEditor] = useState(() => editorOnly ? blankCard() : null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            setCards(await unwrap(window.adsBot.getCreditCards()));
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося завантажити кредитні картки" });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { if (!editorOnly) void load(); }, []);
    const dismiss = () => {
        if (saving) return;
        setEditor(null);
        onCancel?.();
    };

    const save = async () => {
        if (saving || !editor) return;
        setSaving(true);
        try {
            const payload = {
                nickname: editor.nickname.trim(),
                cardholderName: editor.cardholderName.trim(),
                cardNumber: editor.cardNumber.replace(/[\s-]/g, ""),
                securityCode: editor.securityCode.trim(),
                expiration: editor.expiration.trim(),
                postalCode: editor.postalCode.trim(),
                countryCode: editor.countryCode.trim().toUpperCase(),
            };
            const saved = await unwrap(editor.id
                ? window.adsBot.updateCreditCard(editor.id, payload)
                : window.adsBot.createCreditCard(payload));
            setEditor(null);
            if (!editorOnly) await load();
            showToast?.(editor.id ? "Картку оновлено" : "Картку додано", "success");
            onSaved?.(saved);
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося зберегти картку" });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (card) => {
        if (!window.confirm(`Видалити картку «${card.nickname}»?`)) return;
        try {
            await unwrap(window.adsBot.deleteCreditCard(card.id));
            await load();
            showToast?.("Картку видалено", "success");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося видалити картку" });
        }
    };

    const valid = editor
        && editor.nickname.trim()
        && editor.cardholderName.trim()
        && (editor.id || /^\d{12,19}$/.test(editor.cardNumber.replace(/[\s-]/g, "")))
        && /^(0[1-9]|1[0-2])\/\d{2}$/.test(editor.expiration.trim())
        && (!editor.securityCode || /^\d{3,4}$/.test(editor.securityCode))
        && /^[A-Za-z]{2}$/.test(editor.countryCode.trim());

    return <div className="credit-card-settings">
        {!editorOnly && <><div className="credit-card-settings-head">
            <div><h3>Кредитні картки</h3><p>Номер і CVV шифруються системним сховищем Electron. Збережений CVV використовується, якщо його не введено в персональному акаунті.</p></div>
            <button type="button" className="primary-button" onClick={() => setEditor(blankCard())}>
                <Plus size={16} /> Додати картку
            </button>
        </div>
        {loading && <div className="select-empty">Завантаження карток…</div>}
        {!loading && cards.length === 0 && <div className="select-empty">Карток ще немає.</div>}
        <div className="credit-card-grid">
            {cards.map((card) => <article className="credit-card-tile" key={card.id}>
                <div className="credit-card-top">
                    <span className="credit-card-ready"><i /> Готова</span>
                    <strong>{card.network}</strong>
                </div>
                <CreditCard className="credit-card-chip" size={34} />
                <div className="credit-card-identity">
                    <strong>{card.nickname.toUpperCase()}</strong>
                    <small>{card.cardholderName}</small>
                </div>
                <div className="credit-card-number">{card.displayNumber}</div>
                <div className="credit-card-meta">
                    <span>EXP <strong>{card.expiration}</strong></span>
                    {card.postalCode && <span>ZIP <strong>{card.postalCode}</strong></span>}
                </div>
                <div className="credit-card-actions">
                    <button type="button" className="icon-button" title="Редагувати" onClick={() => setEditor({ ...card, cardNumber: "", securityCode: "" })}><Pencil size={15} /></button>
                    <button type="button" className="icon-button danger" title="Видалити" onClick={() => remove(card)}><Trash2 size={15} /></button>
                </div>
            </article>)}
        </div></>}
        {editor && <div className="credit-card-editor">
            <div className="credit-card-editor-head"><strong>{editor.id ? "Редагувати картку" : "Нова картка"}</strong><button type="button" className="icon-button" aria-label="Закрити редактор картки" disabled={saving} onClick={dismiss}><X size={16} /></button></div>
            <div className="credit-card-form">
                <label className="field"><span>Нікнейм</span><input value={editor.nickname} onChange={(event) => setEditor({ ...editor, nickname: event.target.value })} placeholder="MYRAHA 1" /></label>
                <label className="field"><span>Ім’я власника</span><input value={editor.cardholderName} onChange={(event) => setEditor({ ...editor, cardholderName: event.target.value })} /></label>
                <label className="field wide"><span>Номер картки{editor.id ? " · залиште порожнім, щоб не змінювати" : ""}</span><input inputMode="numeric" autoComplete="off" value={editor.cardNumber} onChange={(event) => setEditor({ ...editor, cardNumber: event.target.value })} /></label>
                <label className="field"><span>Строк MM/YY</span><input placeholder="09/28" value={editor.expiration} onChange={(event) => setEditor({ ...editor, expiration: event.target.value })} /></label>
                <label className="field"><span>CVV{editor.hasSecurityCode ? " · залиште порожнім, щоб не змінювати" : " · необов’язково"}</span><input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={editor.securityCode} onChange={(event) => setEditor({ ...editor, securityCode: event.target.value.replace(/\D/g, "") })} /></label>
                <label className="field"><span>Поштовий індекс · необов’язково</span><input value={editor.postalCode} onChange={(event) => setEditor({ ...editor, postalCode: event.target.value })} /></label>
                <label className="field"><span>Країна</span><input maxLength="2" value={editor.countryCode} onChange={(event) => setEditor({ ...editor, countryCode: event.target.value.toUpperCase() })} /></label>
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={dismiss}>Скасувати</button><button type="button" className="primary-button" disabled={!valid || saving} onClick={save}>Зберегти</button></div>
        </div>}
    </div>;
}
