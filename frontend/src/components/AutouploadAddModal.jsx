import { useEffect, useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function AutouploadAddModal({ profiles, onClose, onAdded }) {
    const [groups, setGroups] = useState([]);
    const [groupId, setGroupId] = useState("new");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let live = true;
        unwrap(window.adsBot.getAutoupload()).then((state) => { if (live) setGroups(state.groups); }).catch(() => { if (live) setError("Не вдалося завантажити групи"); });
        return () => { live = false; };
    }, []);
    const submit = async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
            let target = groupId;
            if (name.trim()) {
                const state = await unwrap(window.adsBot.mutateAutoupload({ action: "create", name }));
                setGroups(state.groups);
                target = state.groups.find((group) => group.name === name.trim()).id;
                setGroupId(target); setName("");
            }
            await unwrap(window.adsBot.mutateAutoupload({ action: "add", ids: profiles.map((profile) => profile.profileId), groupId: target }));
            onAdded();
        } catch (failure) { setError(failure.message || "Не вдалося додати профілі"); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Додати до автозаливів" busy={busy} onClose={onClose}>
        <form className="autoupload-form" onSubmit={submit}>
            <p>Вибрано профілів: {profiles.length}. Повторне додавання перемістить профіль у вибрану групу.</p>
            <label>Група<select value={groupId} disabled={busy || !groups.length} onChange={(event) => setGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <label>Або створити нову групу<input value={name} maxLength={100} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Назва нової групи" /></label>
            {error && <p role="alert" className="autoupload-error">{error}</p>}
            <div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary-button" disabled={busy || !groups.length}>{busy ? "Додаємо…" : "Додати"}</button></div>
        </form>
    </WorkspaceDialog>;
}
