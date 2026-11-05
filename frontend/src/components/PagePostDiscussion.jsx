import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, MessageSquareText } from "lucide-react";
import { unwrap } from "../lib/api.js";
import ReactionCounts from "./ReactionCounts.jsx";

const count = (value) => value == null ? "—" : Number(value).toLocaleString("uk-UA");

export default function PagePostDiscussion({ accountKey, pageId, post, disabled, resetKey = post }) {
    const [expanded, setExpanded] = useState(false);
    const [comments, setComments] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const request = useRef(0);
    const pending = useRef(false);

    useEffect(() => {
        request.current += 1;
        pending.current = false;
        setExpanded(false);
        setComments([]);
        setNextCursor(null);
        setLoaded(false);
        setLoading(false);
        setError("");
        return () => { request.current += 1; };
    }, [accountKey, pageId, resetKey]);

    const load = async (after) => {
        if (pending.current || disabled) return;
        pending.current = true;
        const id = ++request.current;
        setLoading(true);
        setError("");
        try {
            const result = await unwrap(window.adsBot.getPagePostComments({
                accountKey, pageId, postId: post.id, ...(after ? { after } : {}),
            }));
            if (id !== request.current) return;
            setComments((current) => {
                const merged = new Map((after ? current : []).map((item) => [item.id, item]));
                for (const item of result.comments) merged.set(item.id, item);
                return [...merged.values()];
            });
            setNextCursor(result.nextCursor && result.nextCursor !== after ? result.nextCursor : null);
            setLoaded(true);
        } catch (failure) {
            if (id === request.current) setError(failure.message || "Не вдалося завантажити коментарі");
        } finally {
            if (id === request.current) { pending.current = false; setLoading(false); }
        }
    };

    return <div className="page-post-discussion">
        <div className="page-post-engagement">
            <ReactionCounts counts={post.reactionCounts} total={post.reactionCount} />
            <span title="Кількість коментарів разом із відповідями"><MessageSquareText size={14} />{count(post.commentCount)} коментарів</span>
            <button type="button" className="page-discussion-toggle" aria-expanded={expanded}
                disabled={disabled} onClick={() => {
                    setExpanded(!expanded);
                    if (!expanded && !loaded) void load();
                }}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? "Згорнути" : "Розгорнути"}
            </button>
        </div>
        {expanded && <div className="page-post-comments" aria-label="Коментарі до поста" aria-busy={loading}>
            {comments.map((comment) => <div key={comment.id}
                className={`page-post-comment${comment.parentId ? " is-reply" : ""}`}>
                {comment.parentId && <small className="page-comment-parent">↳ Відповідь{comment.parentAuthor ? ` · ${comment.parentAuthor}` : " на коментар"}</small>}
                <div className="page-comment-heading"><strong>{comment.author}</strong>
                    {comment.createdTime && <time dateTime={comment.createdTime}>{new Date(comment.createdTime).toLocaleString("uk-UA")}</time>}
                </div>
                <p>{comment.message || (comment.attachmentType ? "Вкладення" : "Без тексту")}</p>
                <div className="page-comment-reactions"><ReactionCounts counts={comment.reactionCounts} total={comment.reactionCount} /></div>
            </div>)}
            {loading && <span className="page-discussion-status" role="status"><LoaderCircle size={15} className="spin" />Завантаження коментарів…</span>}
            {error && <div className="page-discussion-error" role="alert">{error}</div>}
            {!loading && error && <button type="button" className="page-discussion-toggle" onClick={() => void load(loaded ? nextCursor : undefined)}>Спробувати ще</button>}
            {!loading && !error && loaded && !comments.length && <span className="page-discussion-status">Коментарів поки немає</span>}
            {!error && nextCursor && <button type="button" className="page-discussion-toggle" disabled={loading || disabled} onClick={() => void load(nextCursor)}>Показати більше</button>}
        </div>}
    </div>;
}
