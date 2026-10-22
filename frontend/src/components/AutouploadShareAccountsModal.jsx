import { useMemo, useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function AutouploadShareAccountsModal({ profiles, onClose, onQueued }) {
    const groups = useMemo(() => profiles.map(profile => ({ ...profile, accounts: (profile.assets?.adAccounts ?? []).filter(account => account.isPersonal === true && !account.businessId) })), [profiles]);
    const [selected, setSelected] = useState([]);
    const [target, setTarget] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const available = groups.reduce((count, group) => count + group.accounts.length, 0);
    const needsRefresh = profiles.some(profile => !profile.assets?.adAccounts || profile.assets.adAccounts.some(account => typeof account.isPersonal !== "boolean"));
    const toggle = (profileId, adAccountId, checked) => {
        setConfirmed(false);
        setSelected(current => checked ? [...current.filter(item => item.adAccountId !== adAccountId), { profileId, adAccountId }] : current.filter(item => !(item.profileId === profileId && item.adAccountId === adAccountId)));
    };
    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        const targetUserId = target.trim();
        if (!/^[1-9]\d{0,29}$/.test(targetUserId)) { setError("Вкажіть числовий Facebook ID отримувача"); return; }
        if (!selected.length || !confirmed) return;
        setBusy(true); setError("");
        try {
            await unwrap(window.adsBot.shareAutouploadAdAccounts({ ids: profiles.map(profile => profile.profileId), accounts: selected, targetUserId, confirmed: true }));
            onQueued();
        } catch (failure) { setError(failure.message || "Не вдалося запустити надання доступів"); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Пошерити РК" busy={busy} onClose={onClose}><form className="autoupload-form autoupload-share-form" onSubmit={submit}>
        <p>Персональні рекламні кабінети вибраних профілів. Отримувач має бути другом кожного профілю, що надає доступ.</p>
        <label>Facebook ID отримувача<input autoComplete="off" inputMode="numeric" maxLength={30} required disabled={busy} value={target} onChange={event => { setTarget(event.target.value); setConfirmed(false); }} placeholder="Числовий ID Facebook" /></label>
        <div className="autoupload-share-summary"><span>Доступно РК: {available}</span><strong>Вибрано: {selected.length}</strong></div>
        <div className="autoupload-share-list" aria-label="Персональні рекламні кабінети">{groups.map(profile => <section key={profile.profileId}>
            <h3>№{profile.profileNo}<span>{profile.name || "Без назви"}</span></h3>
            {profile.accounts.map(account => <label className="autoupload-share-account" key={account.accountId}>
                <span><strong>{account.name || "Рекламний кабінет"}</strong><small>{account.accountId}</small></span>
                <input className="proxy-public-toggle" type="checkbox" role="switch" aria-label={`Вибрати РК ${account.accountId} профілю ${profile.profileNo}`} disabled={busy} checked={selected.some(item => item.profileId === profile.profileId && item.adAccountId === account.accountId)} onChange={event => toggle(profile.profileId, account.accountId, event.target.checked)} />
            </label>)}
            {!profile.accounts.length && <p className="autoupload-asset-empty">Немає перевірених персональних РК</p>}
        </section>)}</div>
        {needsRefresh && <p className="autoupload-share-note">Для профілів без актуальних даних виконайте «Перевірити сесію», щоб визначити персональні РК.</p>}
        <label className="autoupload-share-confirm"><input type="checkbox" disabled={busy || !selected.length || !target.trim()} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Підтверджую надання повного Admin-доступу користувачу {target.trim() || "із вказаним ID"} до вибраних РК.</span></label>
        {error && <p role="alert" className="autoupload-error">{error}</p>}
        <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary-button" disabled={busy || !selected.length || !confirmed}>{busy ? "Запускаємо…" : "Надати Admin-доступ"}</button></div>
    </form></WorkspaceDialog>;
}
