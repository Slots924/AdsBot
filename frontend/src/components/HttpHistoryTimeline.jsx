import { useState } from "react";

function HistoryEvent({ event }) {
    const [open, setOpen] = useState(false);
    const pending = event.event === "request.started";
    return <details onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
        <summary>{event.sequence ? `${event.sequence}. ` : ""}{event.action ?? event.event} · {event.request?.method} {event.response?.status ?? event.error?.code ?? ""} {event.request?.url ?? ""}{pending ? " · Відповідь не отримана" : ""}</summary>
        {open && <pre>{JSON.stringify(event, null, 2)}</pre>}
    </details>;
}

export default function HttpHistoryTimeline({ events = [] }) {
    const [open, setOpen] = useState(false);
    if (!events.length) return null;
    const completed = new Set(events.filter(event => event.event === "request.finished").map(event => event.requestId));
    const visible = events.filter(event => event.event !== "request.started" || !completed.has(event.requestId));
    return <details onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
        <summary>Історія HTTP-запитів Facebook</summary>
        {open && visible.map((event, index) => <HistoryEvent key={`${event.requestId ?? event.actionId ?? "event"}-${index}`} event={event} />)}
    </details>;
}
