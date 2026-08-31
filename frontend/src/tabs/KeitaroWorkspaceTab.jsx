import KeitaroTab from "./KeitaroTab.jsx";
import KeitaroOffersTab from "./KeitaroOffersTab.jsx";
import KeitaroStreamTemplatesTab from "./KeitaroStreamTemplatesTab.jsx";
import "../styles/keitaro-workspace.css";


export default function KeitaroWorkspaceTab({
    keitaroSubtab = "campaigns",
    onKeitaroSubtabChange = () => {},
    keitaroOffersGrouped = false,
    onKeitaroOffersGroupedChange = () => {},
    ...props
}) {
    return (
        <section className="keitaro-workspace kg-theme">
            <nav className="kg-workspace-tabs" aria-label="Розділи Keitaro">
                <button
                    type="button"
                    className={keitaroSubtab === "campaigns" ? "active" : ""}
                    onClick={() => onKeitaroSubtabChange("campaigns")}
                >
                    Кампанії
                </button>
                <button
                    type="button"
                    className={keitaroSubtab === "offers" ? "active" : ""}
                    onClick={() => onKeitaroSubtabChange("offers")}
                >
                    Офери
                </button>
                <button
                    type="button"
                    className={keitaroSubtab === "streams" ? "active" : ""}
                    onClick={() => onKeitaroSubtabChange("streams")}
                >
                    Шаблони потоків
                </button>
            </nav>
            <div className="kg-workspace-body">
            {keitaroSubtab === "campaigns" ? (
                <KeitaroTab {...props} />
            ) : keitaroSubtab === "offers" ? (
                <KeitaroOffersTab
                    grouped={keitaroOffersGrouped}
                    onGroupedChange={onKeitaroOffersGroupedChange}
                    onError={props.onError}
                    showToast={props.showToast}
                />
            ) : (
                <KeitaroStreamTemplatesTab
                    onError={props.onError}
                    showToast={props.showToast}
                />
            )}
            </div>
        </section>
    );
}
