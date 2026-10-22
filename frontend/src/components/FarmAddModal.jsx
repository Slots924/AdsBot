import { useEffect, useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";

export default function FarmAddModal({ profiles, onClose, onAdded }) {
    const [groups, setGroups] = useState([]);
    const [groupId, setGroupId] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let live = true;
        unwrap(window.adsBot.getFarmSnapshot()).then((state) => {
            if (live) { setGroups(state.groups); setGroupId(state.groups[0]?.id ?? ""); }
        }).catch((failure) => { if (live) setError(failure.message); });
        return () => { live = false; };
    }, []);
    const submit = async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        try {
            let target = groupId;
            if (name.trim()) {
                const created = await unwrap(window.adsBot.saveFarmGroup({ name }));
                target = created.id; setGroups((items) => [...items, created]); setGroupId(target); setName("");
            }
            await unwrap(window.adsBot.assignFarmProfiles(target, profiles.map((profile) => profile.profileNo)));
            onAdded();
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Додати до групи фарму" busy={busy} onClose={onClose}>
        <form className="farm-form" onSubmit={submit}>
            <p>Вибрано акаунтів: {profiles.length}. Попередня історія збережеться, акаунти перейдуть у вибрану групу.</p>
            <label>Група фарму<select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy}><option value="">Оберіть групу</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <label>Або нова група<input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
            {error && <p role="alert">{error}</p>}
            <button className="primary-button" disabled={busy || (!groupId && !name.trim())}>Додати</button>
        </form>
    </WorkspaceDialog>;
}
