import { LoaderCircle } from "lucide-react";

export default function EntityStatusToggle({ active, pending, disabled, label, title, onClick }) {
    return <span className="entity-status-control">
        <button type="button" className={`campaign-state-toggle ${active ? "active" : ""} ${pending ? "pending" : ""}`} role="switch" aria-checked={active} aria-label={label} title={title || label} disabled={disabled || pending} onClick={onClick}><i /></button>
        <span className="entity-status-progress">{pending && <LoaderCircle className="spin" size={13} aria-label="Оновлюється статус" />}</span>
    </span>;
}
