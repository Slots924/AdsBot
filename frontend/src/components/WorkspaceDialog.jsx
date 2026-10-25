import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function WorkspaceDialog({ title, children, onClose, busy = false, className = "" }) {
    const titleId = useId();
    const content = useRef(null);
    const close = useRef(onClose);
    const busyRef = useRef(busy);
    close.current = onClose;
    busyRef.current = busy;
    useEffect(() => {
        const previous = document.activeElement;
        const focusable = () => [...content.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
        (focusable()[0] ?? content.current).focus();
        const keydown = (event) => {
            if (event.key === "Escape" && !busyRef.current) close.current();
            if (event.key !== "Tab") return;
            const items = focusable();
            const index = items.indexOf(document.activeElement);
            if (!items.length) { event.preventDefault(); content.current.focus(); }
            else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus(); }
            else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
        };
        document.addEventListener("keydown", keydown);
        return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
    }, []);
    return <div className="overlay"><div className={`modal workspace-dialog ${className}`} ref={content} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button type="button" className="modal-close" aria-label="Закрити" disabled={busy} onClick={onClose}><X size={17} /></button>
        <h2 id={titleId}>{title}</h2>{children}
    </div></div>;
}
