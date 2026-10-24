import { useState } from "react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { unwrap } from "../lib/api.js";
import { autouploadProfileActions } from "../lib/autouploadProfileActions.js";

export default function AutouploadProfileActionModal({ action, ids, onClose, onQueued }) {
    const [imagePath, setImagePath] = useState("");
    const [posts, setPosts] = useState([]);
    const [bio, setBio] = useState("");
    const [education, setEducation] = useState("");
    const [company, setCompany] = useState("");
    const [position, setPosition] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pick = async () => {
        setBusy(true); setError("");
        try {
            if (action === "publish-posts") {
                const images = await unwrap(window.adsBot.selectImages());
                if (images?.length) setPosts(current => [...current, ...images.map(path => ({ mediaPaths: [path], targetDate: "", text: "" }))]);
            } else {
                const path = await unwrap(window.adsBot.selectImage());
                if (path) setImagePath(path);
            }
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
            const input = ["avatar", "cover"].includes(action) ? { imagePath }
                : action === "publish-posts" ? { posts }
                : action === "bio" ? { value: bio }
                : action === "about" ? { education, work: { company, position } }
                : { confirmed };
            await unwrap(window.adsBot.runAutouploadProfileAction(ids, action, input));
            onQueued();
        } catch (failure) { setError(failure.message || "Не вдалося запустити дію"); }
        finally { setBusy(false); }
    };
    const invalid = ["avatar", "cover"].includes(action) ? !imagePath
        : action === "clear-posts" ? !confirmed
        : action === "publish-posts" ? !posts.length || posts.some(post => !post.targetDate)
        : action === "about" ? (!education.trim() && !company.trim()) || Boolean(company.trim()) !== Boolean(position.trim()) : false;
    const changePost = (index, patch) => setPosts(current => current.map((post, i) => i === index ? { ...post, ...patch } : post));
    return <WorkspaceDialog title={`${autouploadProfileActions[action]} · соціальний профіль`} onClose={onClose} busy={busy}>
        <form className="autoupload-form" onSubmit={submit}>
            <p>Вибрано профілів: {ids.length}. Введені дані застосуються до кожного вибраного соціального профілю. Результат з’явиться в журналі операцій.</p>
            {["avatar", "cover", "publish-posts"].includes(action) && <><button className="secondary-button" type="button" disabled={busy} onClick={pick}>{action === "publish-posts" ? "Додати фотографії" : "Вибрати фотографію"}</button>{imagePath && <p className="autoupload-file" title={imagePath}>{imagePath.split(/[\\/]/).pop()}</p>}</>}
            {action === "clear-posts" && <><p>Звичайні пости буде видалено. Системні пости аватарки й обкладинки буде приховано з хроніки, якщо Facebook дозволяє.</p><label className="autoupload-remove-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Підтверджую очищення постів вибраних соціальних профілів</label></>}
            {action === "publish-posts" && <><p>Кожна фотографія — окремий публічний пост. Спочатку пост публікується, потім отримує вказану минулу дату, 12:00.</p>{posts.map((post, index) => <fieldset className="autoupload-post-editor" key={index}><legend>Пост {index + 1} · {post.mediaPaths[0].split(/[\\/]/).pop()}</legend><label>Дата поста {index + 1}<input type="date" required value={post.targetDate} disabled={busy} onChange={event => changePost(index, { targetDate: event.target.value })} /></label><label>Текст поста {index + 1}<textarea value={post.text} disabled={busy} maxLength={60000} onChange={event => changePost(index, { text: event.target.value })} /></label><button className="secondary-button" type="button" disabled={busy} onClick={() => setPosts(current => current.filter((_, i) => i !== index))}>Прибрати пост {index + 1}</button></fieldset>)}</>}
            {action === "bio" && <label>Bio<textarea maxLength={101} value={bio} disabled={busy} onChange={event => setBio(event.target.value)} /><small>До 101 символу. Порожнє поле очистить Bio.</small></label>}
            {action === "about" && <><p>Заповніть потрібні поля. Порожні поля залишаться без змін. Освіта оновлює перший запис College; робота додає новий запис і після успіху видаляє попередній.</p><label>Навчальний заклад<input maxLength={200} value={education} disabled={busy} onChange={event => setEducation(event.target.value)} /></label><label>Компанія<input maxLength={200} value={company} disabled={busy} onChange={event => setCompany(event.target.value)} /></label><label>Посада<input maxLength={200} value={position} disabled={busy} onChange={event => setPosition(event.target.value)} /></label></>}
            {error && <p role="alert" className="autoupload-error">{error}</p>}
            <div className="inline-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Скасувати</button><button className="primary-button" disabled={busy || invalid}>{busy ? "Запускаємо…" : "Виконати"}</button></div>
        </form>
    </WorkspaceDialog>;
}
