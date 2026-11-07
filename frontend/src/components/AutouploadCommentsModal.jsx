import { useMemo, useState } from "react";
import { ArrowRight, Check, ListOrdered, MessageSquare, Users } from "lucide-react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";
import "../styles/autoupload-comments.css";

function validPostUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && ["www.facebook.com", "facebook.com"].includes(url.hostname)
            && url.pathname === "/permalink.php" && /^(?:pfbid[A-Za-z0-9]+|[1-9]\d*)$/.test(url.searchParams.get("story_fbid") ?? "");
    } catch { return false; }
}

export default function AutouploadCommentsModal({ profiles, onClose, onQueued }) {
    const [postUrl, setPostUrl] = useState("");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const comments = useMemo(() => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean), [text]);
    const valid = validPostUrl(postUrl.trim()) && comments.length > 0 && comments.length <= 1000
        && comments.every(comment => comment.length <= 8000) && profiles.length > 0;
    const submit = async event => {
        event.preventDefault();
        if (busy || !valid) return;
        setBusy(true); setError("");
        try {
            const task = await unwrap(window.adsBot.publishAutouploadComments(profiles.map(profile => profile.profileId), { postUrl: postUrl.trim(), comments }));
            onQueued(task);
        } catch (failure) { setError(failure.message || "Не вдалося запустити публікацію коментарів"); }
        finally { setBusy(false); }
    };
    return <WorkspaceDialog title="Написати коментарі" onClose={onClose} busy={busy} className="autoupload-comments-dialog">
        <form className="autoupload-form" onSubmit={submit}>
            <div className="comment-compose-intro"><span className="comment-compose-icon"><MessageSquare size={22} /></span><p>Один пост. Послідовна черга.<small>Після успішної публікації наступний акаунт бере наступний коментар.</small></p></div>
            <div className="comment-compose-stats"><span><Users size={16} /><strong>{profiles.length}</strong> акаунтів</span><ArrowRight size={16} /><span><ListOrdered size={16} /><strong>{comments.length}</strong> коментарів</span><span className="comment-compose-counter"><Check size={14} /> AU_COMMENT +1 за успіх</span></div>
            <label>Посилання на пост<input type="url" required autoComplete="off" value={postUrl} disabled={busy} onChange={event => setPostUrl(event.target.value)} placeholder="https://www.facebook.com/permalink.php?story_fbid=…&id=…" aria-describedby="comment-url-help" /></label>
            <small id="comment-url-help" className={postUrl && !validPostUrl(postUrl.trim()) ? "autoupload-error" : "comment-compose-hint"}>Пряме посилання Facebook: permalink.php зі story_fbid.</small>
            <div className="comment-compose-columns">
                <label>Коментарі<textarea rows={8} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder={"Гарне фото!\nДякую, що поділилися.\nДуже атмосферно!"} /><small className="comment-compose-hint">Кожен непорожній рядок — окремий коментар.</small></label>
                <section className="comment-compose-preview" aria-label="Черга коментарів"><div className="comment-compose-preview-title"><span>Черга публікації</span><span>{comments.length}</span></div>
                    {comments.length ? <ol>{comments.map((comment, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{comment}</p></li>)}</ol> : <div className="comment-compose-empty"><ListOrdered size={28} /><p>Тут з’являться коментарі<small>Додайте текст ліворуч</small></p></div>}
                </section>
            </div>
            <div className="comment-compose-rules"><p><strong>Як працює черга</strong> Відмова — той самий коментар пробує наступний акаунт. Невідомий результат — коментар пропускається.</p><small>Порядок акаунтів: {profiles.map(profile => `№${profile.profileNo}`).join(" → ")}</small></div>
            {comments.length > profiles.length && <p className="comment-compose-warning">Коментарів більше, ніж акаунтів. Невикористані коментарі залишаться у звіті.</p>}
            {(comments.length > 1000 || comments.some(comment => comment.length > 8000)) && <p role="alert" className="autoupload-error">До 1000 коментарів, максимум 8000 символів у кожному.</p>}
            {error && <p role="alert" className="autoupload-error">{error}</p>}
            <div className="comment-compose-footer"><small>Результати та ID коментарів — у журналі операцій.</small><div className="inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary-button" disabled={busy || !valid}><MessageSquare size={16} />{busy ? "Запускаємо…" : "Запустити чергу"}</button></div></div>
        </form>
    </WorkspaceDialog>;
}
