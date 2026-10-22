import { useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function AutouploadTransferModal({ profiles, workspace, onClose, onQueued }) {
    const [groupId, setGroupId] = useState("new");
    const [targetProfileId, setTargetProfileId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const targets = workspace.profiles.filter(profile => profile.groupId === groupId && !profiles.some(donor => donor.profileId === profile.profileId));
    const target = targets.find(profile => profile.profileId === targetProfileId);
    const ready = target?.assets?.adAccountsState === "loaded" && profiles.every(profile => profile.assets?.adAccountsState === "loaded");
    const submit = async event => {
        event.preventDefault();
        if (busy || !ready) return;
        setBusy(true); setError("");
        try {
            await unwrap(window.adsBot.transferAutouploadPersonalAccounts({ ids: profiles.map(profile => profile.profileId), targetProfileId }));
            onQueued();
        } catch (failure) { setError(failure.message || "Не вдалося запустити передачу РК"); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Передати персональні РК кінгу" busy={busy} onClose={onClose}><form className="autoupload-form" onSubmit={submit}>
        <p>Донорів: {profiles.length}. Будуть надані Admin-доступи до персональних РК, яких немає у збереженому списку кінга. Заявки та їх прийняття виконуються автоматично лише для донорів із РК для передачі.</p>
        <label>Група кінга<select disabled={busy} value={groupId} onChange={event => { setGroupId(event.target.value); setTargetProfileId(""); }}>{workspace.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Профіль кінга<select required disabled={busy} value={targetProfileId} onChange={event => setTargetProfileId(event.target.value)}><option value="">Оберіть профіль</option>{targets.map(profile => <option key={profile.profileId} value={profile.profileId}>№{profile.profileNo} · {profile.name || "Без назви"}</option>)}</select></label>
        {(!profiles.every(profile => profile.assets?.adAccountsState === "loaded") || (target && !ready)) && <p role="alert">Немає збереженого повного списку РК. Спочатку виконайте перевірку відповідних профілів.</p>}
        {error && <p role="alert" className="autoupload-error">{error}</p>}
        <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary-button" disabled={busy || !ready}>{busy ? "Запускаємо…" : "Додати в друзі та передати РК"}</button></div>
    </form></WorkspaceDialog>;
}
