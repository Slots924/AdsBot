import { useMemo, useState } from "react";
import { Heart, ThumbsUp, UsersRound } from "lucide-react";

import { unwrap } from "../lib/api.js";


const reactionFields = [
    { id: "like", label: "Like", icon: ThumbsUp },
    { id: "love", label: "Love", icon: Heart },
    { id: "care", label: "Care", icon: UsersRound },
];


export default function CommentReactionsModal({
    profiles = [],
    settings = {},
    onClose,
    onQueued,
    onError,
}) {
    const [postUrl, setPostUrl] = useState("");
    const [reactions, setReactions] = useState({ like: 0, love: 0, care: 0 });
    const [includeReplies, setIncludeReplies] = useState(false);
    const [saving, setSaving] = useState(false);
    const requested = useMemo(
        () => Object.values(reactions).reduce((sum, value) => sum + value, 0),
        [reactions]
    );
    const setReaction = (id, value) => setReactions((current) => ({
        ...current,
        [id]: Math.max(0, Math.floor(Number(value) || 0)),
    }));
    const submit = async (event) => {
        event.preventDefault();
        if (!postUrl.trim() || requested === 0 || saving) return;
        setSaving(true);
        try {
            const result = await unwrap(window.adsBot.runCommentReactions({
                profileNos: profiles.map((profile) => profile.profileNo),
                postUrl,
                reactions,
                includeReplies,
                browserMode: settings.reactionBrowserMode,
                disableImages: settings.reactionDisableImages,
                workerConcurrency: settings.reactionWorkerConcurrency,
                workerProxyIds: settings.reactionWorkerProxyIds,
            }));
            onQueued?.(result);
        } catch (error) {
            onError?.({ title: "Не вдалося поставити задачу реакцій у чергу", message: error.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overlay" onMouseDown={onClose}>
            <form className="modal create-comment-accounts-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
                <h2>Реакції під коментарями</h2>
                <p className="settings-hint">Вибрано профілів: {profiles.length}. Профілі використовуються як резерв, якщо попередні не відкрилися або не поставили жодної реакції.</p>
                <label className="field">
                    <span>URL поста Facebook</span>
                    <input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://www.facebook.com/..." autoFocus />
                </label>
                <div className="form-grid">
                    {reactionFields.map(({ id, label, icon: Icon }) => (
                        <label className="field" key={id}>
                            <span><Icon size={15} /> {label}</span>
                            <input type="number" min="0" step="1" value={reactions[id]} onChange={(event) => setReaction(id, event.target.value)} />
                        </label>
                    ))}
                </div>
                <label className="checkbox-line">
                    <input type="checkbox" checked={includeReplies} onChange={(event) => setIncludeReplies(event.target.checked)} />
                    <span><strong>Лайкати також replies</strong><small>Розгортає відповіді та ставить реакцію і під ними.</small></span>
                </label>
                <p className="settings-hint">Потрібно успішних профілів: {requested}. Наявно для резерву: {profiles.length}.</p>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>Скасувати</button>
                    <button className="primary-button" disabled={saving || !postUrl.trim() || requested === 0}>У чергу</button>
                </div>
            </form>
        </div>
    );
}
