import { useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function AutouploadFriendRequestModal({ profiles, onClose, onQueued }) {
    const [targetUserId, setTargetUserId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const target = targetUserId.trim();
        if (!/^[1-9]\d{0,29}$/.test(target)) { setError("Вкажіть числовий Facebook ID отримувача"); return; }
        setBusy(true); setError("");
        try {
            await unwrap(window.adsBot.sendAutouploadFriendRequests(profiles.map((profile) => profile.profileId), target));
            onQueued();
        } catch (failure) { setError(failure.message || "Не вдалося запустити надсилання заявок"); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Додати в друзі" busy={busy} onClose={onClose}><form className="autoupload-form" onSubmit={submit}>
        <p>Вибрано профілів: {profiles.length}. Кожен профіль по черзі надішле заявку одному вказаному отримувачу.</p>
        <label>Facebook ID отримувача<input autoComplete="off" inputMode="numeric" maxLength={30} required disabled={busy} value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} placeholder="Числовий ID Facebook" /></label>
        {error && <p role="alert" className="autoupload-error">{error}</p>}
        <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary-button" disabled={busy || !profiles.length}>{busy ? "Запускаємо…" : "Надіслати заявки"}</button></div>
    </form></WorkspaceDialog>;
}
