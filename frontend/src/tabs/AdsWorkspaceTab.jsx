import { useState } from "react";

import AdAccountsTab from "./AdAccountsTab.jsx";
import TemplatesTab from "./TemplatesTab.jsx";


export default function AdsWorkspaceTab({ adsSubtab, onSubtabChange, ...props }) {
    const [localSubtab, setLocalSubtab] = useState("accounts");
    const active = adsSubtab ?? localSubtab;
    const change = onSubtabChange ?? setLocalSubtab;

    return (
        <section className="ads-workspace-tab">
            <div className="inner-tabs">
                <button className={active === "accounts" ? "active" : ""} onClick={() => change("accounts")}>Рекламні кабінети</button>
                <button className={active === "templates" ? "active" : ""} onClick={() => change("templates")}>Шаблони</button>
            </div>
            {active === "accounts"
                ? <AdAccountsTab {...props} />
                : <TemplatesTab onError={props.onError} showToast={props.showToast} />}
        </section>
    );
}
