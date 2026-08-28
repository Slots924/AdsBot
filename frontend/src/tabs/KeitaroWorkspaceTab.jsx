import KeitaroTab from "./KeitaroTab.jsx";
import KeitaroStreamTemplatesTab from "./KeitaroStreamTemplatesTab.jsx";


export default function KeitaroWorkspaceTab({
    keitaroSubtab = "campaigns",
    onKeitaroSubtabChange = () => {},
    ...props
}) {
    return (
        <section className="keitaro-workspace">
            <div className="inner-tabs keitaro-inner-tabs">
                <button
                    type="button"
                    className={keitaroSubtab === "campaigns" ? "active" : ""}
                    onClick={() => onKeitaroSubtabChange("campaigns")}
                >
                    Кампанії
                </button>
                <button
                    type="button"
                    className={keitaroSubtab === "streams" ? "active" : ""}
                    onClick={() => onKeitaroSubtabChange("streams")}
                >
                    Шаблони потоків
                </button>
            </div>
            {keitaroSubtab === "campaigns" ? (
                <KeitaroTab {...props} />
            ) : (
                <KeitaroStreamTemplatesTab
                    onError={props.onError}
                    showToast={props.showToast}
                />
            )}
        </section>
    );
}
