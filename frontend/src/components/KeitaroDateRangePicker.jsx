import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

import { GrayButton } from "./gray-ui/index.js";
import { keitaroDatePresets } from "../lib/keitaro.js";


function todayIso() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}


function formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", year: "numeric" })
        .format(new Date(`${value}T12:00:00`));
}


export default function KeitaroDateRangePicker({
    preset = "today",
    range = null,
    onPresetChange = () => {},
    onRangeChange = () => {},
}) {
    const root = useRef(null);
    const initial = range?.from || todayIso();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState(range?.from && range?.to && range.from !== range.to ? "range" : "day");
    const [from, setFrom] = useState(initial);
    const [to, setTo] = useState(range?.to || initial);

    useEffect(() => {
        const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const label = range?.from
        ? range.from === range.to
            ? formatDate(range.from)
            : `${formatDate(range.from)} — ${formatDate(range.to)}`
        : keitaroDatePresets.find((item) => item.id === preset)?.label || "Період";

    const apply = () => {
        const end = mode === "day" ? from : to;
        if (!from || !end) return;
        onRangeChange({ from, to: end });
        setOpen(false);
    };

    return <div className="kg-date-picker" ref={root}>
        <GrayButton className="kg-date-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            <CalendarDays size={16} />
            <span>{label}</span>
            <ChevronDown size={15} />
        </GrayButton>
        {open && <div className="kg-date-popover">
            <div className="kg-date-presets">
                {keitaroDatePresets.map((item) => <button key={item.id} type="button" className={!range && preset === item.id ? "active" : ""} onClick={() => { onPresetChange(item.id); onRangeChange(null); setOpen(false); }}>{item.label}</button>)}
            </div>
            <div className="kg-date-mode" role="group" aria-label="Режим вибору дати">
                <button type="button" className={mode === "day" ? "active" : ""} onClick={() => setMode("day")}>Один день</button>
                <button type="button" className={mode === "range" ? "active" : ""} onClick={() => setMode("range")}>Інтервал</button>
            </div>
            <div className="kg-date-fields">
                <label><span>{mode === "day" ? "Дата" : "Від"}</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); if (mode === "day") setTo(event.target.value); }} /></label>
                {mode === "range" && <label><span>До</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>}
            </div>
            <div className="kg-date-actions"><GrayButton variant="primary" disabled={!from || (mode === "range" && !to)} onClick={apply}>Застосувати</GrayButton></div>
        </div>}
    </div>;
}
