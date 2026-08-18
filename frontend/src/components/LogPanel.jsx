import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Terminal, Trash2 } from "lucide-react";


export default function LogPanel({ logs, onClear }) {
    const [collapsed, setCollapsed] = useState(false);
    const endRef = useRef(null);

    useEffect(() => {
        if (!collapsed) {
            endRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs, collapsed]);

    return (
        <section className={`log-panel ${collapsed ? "collapsed" : ""}`}>
            <header>
                <div><Terminal size={16} /><strong>Журнал подій</strong><span>{logs.length}</span></div>
                <div>
                    <button className="icon-button" onClick={onClear} title="Очистити"><Trash2 size={15} /></button>
                    <button className="icon-button" onClick={() => setCollapsed((value) => !value)}>
                        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </header>
            {!collapsed && (
                <div className="log-lines">
                    {logs.length === 0 && <p className="empty-log">Тут з’являтимуться події backend.</p>}
                    {logs.map((log) => (
                        <p className={`log-line ${log.level}`} key={log.id}>
                            <time>{new Date(log.timestamp).toLocaleTimeString("uk-UA")}</time>
                            <b>{log.scope || "app"}</b>
                            <span>{log.message}</span>
                        </p>
                    ))}
                    <div ref={endRef} />
                </div>
            )}
        </section>
    );
}
