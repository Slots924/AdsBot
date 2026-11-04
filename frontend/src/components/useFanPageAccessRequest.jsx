import { useEffect, useRef, useState } from "react";
import { unwrap } from "../lib/api.js";
import WorkspaceDialog from "./WorkspaceDialog.jsx";

export default function useFanPageAccessRequest() {
    const [request, setRequest] = useState(null);
    const [password, setPassword] = useState("");
    const pending = useRef(null);
    useEffect(() => () => { pending.current?.(null); }, []);
    const finish = value => {
        pending.current?.(value);
        pending.current = null;
        setPassword("");
        setRequest(null);
    };
    const send = async (payload, { signal } = {}) => {
        const result = await unwrap(window.adsBot.shareAutouploadFanPage(payload));
        if (result.code !== "FACEBOOK_PASSWORD_REQUIRED" || result.outcomeUnknown || signal?.aborted) return result;
        // Повтор дозволений лише після відмови до надсилання інвайту та введення пароля.
        const credential = await new Promise(resolve => {
            pending.current = resolve;
            setPassword("");
            setRequest(result);
            signal?.addEventListener("abort", cancel, { once: true });
        });
        signal?.removeEventListener("abort", cancel);
        if (credential === null || signal?.aborted) return { ...result, message: "Надання доступу скасовано." };
        return unwrap(window.adsBot.shareAutouploadFanPage({ ...payload, password: credential }));
    };
    function cancel() { finish(null); }
    const dialog = request && <WorkspaceDialog title="Не вказано пароль Facebook" onClose={cancel}>
        <form onSubmit={event => { event.preventDefault(); if (password) finish(password); }}>
            <p>У профілі FP HUB в AdsPower відсутній пароль Facebook. Введіть його для надання доступу до фанки.</p>
            <label className="field"><span>Пароль Facebook</span><input type="password" autoFocus autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
            <div className="form-actions">
                <button type="button" className="secondary-button" onClick={cancel}>Скасувати</button>
                <button type="submit" className="primary-button" disabled={!password}>Повторити з цим паролем</button>
            </div>
        </form>
    </WorkspaceDialog>;
    return { send, dialog };
}
