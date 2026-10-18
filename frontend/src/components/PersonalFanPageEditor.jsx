import { useEffect, useRef, useState } from "react";
import { Dices, LoaderCircle, Square } from "lucide-react";
import { unwrap } from "../lib/api.js";
import SearchSelect from "./SearchSelect.jsx";
import "../styles/personal-fanpage-editor.css";

const fields = [
    ["bio", "Біо", [["bio", "Біо"]]],
    ["address", "Адреса", [["street", "Адреса"], ["city", "Місто"], ["zip", "Поштовий індекс"]]],
    ["links", "Посилання", [["links", "Посилання"]]],
    ["work", "Робота", [["company", "Компанія"], ["position", "Посада"]]],
    ["education", "Освіта", [["education", "Освіта"]]],
    ["instagram", "Інстаграм", [["instagram", "@назва_акаунта"]]],
    ["phone", "Номер телефону", [["phone", "Номер телефону"]]],
    ["email", "Емейл", [["email", "Емейл"]]],
];

function Status({ value }) {
    if (!value) return null;
    return <div role="status" className={`fanpage-edit-status ${value.state}`}>
        {value.state === "running" && <LoaderCircle size={14} className="spin" />}{value.text}
    </div>;
}

export default function PersonalFanPageEditor({ session, busy, setBusy }) {
    const [countries, setCountries] = useState([]);
    const [geo, setGeo] = useState("");
    const [data, setData] = useState({ name: "", bio: "" });
    const [enabled, setEnabled] = useState(Object.fromEntries(["photos", ...fields.map(([key]) => key)].map((key) => [key, true])));
    const [imagePaths, setImagePaths] = useState([]);
    const [changeDates, setChangeDates] = useState(false);
    const [minimumDate, setMinimumDate] = useState("");
    const [statuses, setStatuses] = useState({});
    const [passwordRequest, setPasswordRequest] = useState(null);
    const [password, setPassword] = useState("");
    const stop = useRef(false);
    const working = useRef(false);
    const locked = Boolean(busy);
    const status = (key, state, text) => setStatuses((current) => ({ ...current, [key]: { state, text } }));
    const update = (key, value) => setData((current) => ({ ...current, [key]: value }));

    useEffect(() => {
        unwrap(window.adsBot.getCountries()).then(setCountries).catch((error) => status("generate", "error", error.message));
    }, []);

    const generate = async () => {
        if (!geo || working.current) return;
        working.current = true;
        setBusy("fanpage.edit.generate");
        status("generate", "running", "Підготовка даних…");
        try {
            const value = await unwrap(window.adsBot.generatePersonalFanPageData({ geo }));
            setData((current) => ({ ...current, name: `${value.firstName} ${value.lastName}`,
                company: value.company || "", position: value.profession || "", education: value.university || "",
                email: value.email, instagram: value.instagram }));
            status("generate", "success", "Дані заповнено");
        } catch (error) { status("generate", "error", error.message); }
        finally { working.current = false; setBusy(""); }
    };

    const changeName = async (credential) => {
        if (!session || working.current) return;
        working.current = true;
        setBusy("fanpage.edit.name");
        status("name", "running", "Змінюємо назву…");
        try {
            const request = passwordRequest ?? {
                ...await unwrap(window.adsBot.preparePersonalFanPageEdit(session.id, {})), name: data.name.trim(),
            };
            try {
                const result = await unwrap(window.adsBot.editPersonalFanPage(session.id, {
                    action: "name", actorId: request.actorId, name: request.name,
                    ...(credential === undefined ? {} : { password: credential }),
                }));
                if (!result.success) throw new Error(result.error);
                setPasswordRequest(null);
                status("name", "success", "Назву успішно змінено");
            } catch (error) {
                if (error.code === "FACEBOOK_PASSWORD_REQUIRED") {
                    setPasswordRequest(request);
                    status("name", "pending", "Потрібен пароль Facebook");
                } else { throw error; }
            }
        } catch (error) { status("name", "error", error.message); }
        finally { setPassword(""); working.current = false; setBusy(""); }
    };

    const runAll = async () => {
        if (!session || working.current) return;
        working.current = true;
        stop.current = false;
        setBusy("fanpage.edit.batch");
        setStatuses({});
        status("batch", "running", "Підготовка змін…");
        try {
            const plan = await unwrap(window.adsBot.preparePersonalFanPageEdit(session.id, {
                ...(enabled.photos && imagePaths.length ? { photos: { imagePaths, changeDates, minimumDate } } : {}),
            }));
            const jobs = [];
            if (enabled.photos && plan.photos.length) {
                jobs.push(["photos", plan.photos]);
                status("photos", "pending", "Очікує виконання");
            }
            else status("photos", "pending", enabled.photos ? "Пропущено: фото не вибрано" : "Вимкнено");
            for (const [key, , inputs] of fields) {
                if (!enabled[key] || (key !== "bio" && !inputs.some(([field]) => String(data[field] ?? "").trim()))) {
                    status(key, "pending", enabled[key] ? "Пропущено: порожнє поле" : "Вимкнено");
                    continue;
                }
                jobs.push([key, [{ action: key, value: data[key] ?? "", fields: Object.fromEntries(inputs.map(([field]) => [field, String(data[field] ?? "").trim()])) }]]);
                status(key, "pending", "Очікує виконання");
            }
            let failures = 0;
            for (const [key, actions] of jobs) {
                if (stop.current) break;
                try {
                    for (const action of actions) {
                        if (stop.current) break;
                        status(key, "running", `${action.label ?? "Зміна даних"} — у процесі…`);
                        const result = await unwrap(window.adsBot.editPersonalFanPage(session.id, { ...action, actorId: plan.actorId }));
                        if (!result.success) throw new Error(result.error || result.status);
                    }
                    status(key, stop.current ? "pending" : "success", stop.current ? "Зупинено" : "Успішно");
                } catch (error) {
                    failures += 1;
                    status(key, "error", error.message);
                    if (["FANPAGE_CHANGED", "EDIT_STOPPED"].includes(error.code)) stop.current = true;
                }
            }
            if (stop.current) {
                setStatuses((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key,
                    value.text === "Очікує виконання" ? { state: "pending", text: "Пропущено після зупинки" } : value])));
            }
            status("batch", stop.current ? "pending" : failures ? "error" : "success", stop.current ? "Зупинено" : failures ? `Завершено. Невиконаних пунктів: ${failures}` : "Усі вибрані зміни виконано");
        } catch (error) { status("batch", "error", error.message); }
        finally { working.current = false; setBusy(""); }
    };

    const stopBatch = async () => {
        stop.current = true;
        status("batch", "pending", "Зупиняємо після поточного запиту…");
        try { await unwrap(window.adsBot.stopPersonalFanPageEdit(session.id)); }
        catch (error) { status("batch", "error", error.message); }
    };

    const toggle = (key, label) => <label className="checkbox-line"><input type="checkbox" role="switch"
        checked={enabled[key]} disabled={locked} onChange={(event) => setEnabled((current) => ({ ...current, [key]: event.target.checked }))} />
        <span><strong>{label}</strong></span></label>;

    return <section className="personal-section fanpage-editor">
        <div className="personal-section-heading"><div><h3>Редагувати дані фанпейджі</h3>
            <p>Зміни застосовуються до фанпейджі, відкритої у Facebook.</p></div></div>
        {!session && <p className="personal-note">Спочатку запустіть профіль у вкладці «Огляд».</p>}
        <div className="personal-action-card">
            <div className="personal-inline-actions">
                <SearchSelect items={countries} value={geo} onChange={setGeo} getId={(item) => item.code}
                    getTitle={(item) => item.code === "GB" ? "UK" : item.code} getSubtitle={(item) => item.name}
                    getSearchText={(item) => `${item.code} ${item.name} ${(item.aliases ?? []).join(" ")}`}
                    placeholder="Виберіть країну" searchPlaceholder="Назва або код країни…" ariaLabel="Гео для даних фанпейджі" disabled={locked} />
                <button type="button" className="secondary-button" title="Згенерувати дані" aria-label="Згенерувати дані" disabled={!geo || locked} onClick={generate}><Dices size={18} /></button>
            </div><Status value={statuses.generate} />
            <label className="field"><span>Ім’я / назва фанпейджі</span><input value={data.name} disabled={locked || Boolean(passwordRequest)} onChange={(event) => update("name", event.target.value)} /></label>
            <div className="personal-inline-actions"><button type="button" className="primary-button" disabled={!session || locked || !data.name.trim() || Boolean(passwordRequest)} onClick={() => void changeName()}>Змінити</button><Status value={statuses.name} /></div>
        </div>
        <div className="personal-action-card">{toggle("photos", "Змінити фотографії")}
            <button type="button" className="secondary-button" disabled={locked || !enabled.photos} onClick={async () => {
                try { const paths = await unwrap(window.adsBot.selectImages()); if (paths.length) setImagePaths(paths); }
                catch (error) { status("photos", "error", error.message); }
            }}>Вибрати декілька фото</button>
            <small>1 — аватарка, 2 — обкладинка, решта — фото-пости. Попередні пости видаляються, системні приховуються.</small>
            {imagePaths.length > 0 && <div className="fanpage-photo-list">{imagePaths.map((file) => <small key={file}>{file.split(/[\\/]/).pop()}</small>)}
                <button type="button" className="secondary-button" disabled={locked} onClick={() => setImagePaths([])}>Очистити вибір</button></div>}
            <label className="checkbox-line"><input type="checkbox" checked={changeDates} disabled={locked || !enabled.photos} onChange={(event) => setChangeDates(event.target.checked)} /><span>Змінити дати фото-постів</span></label>
            {changeDates && <label className="field"><span>Найраніша дата</span><input type="date" value={minimumDate} disabled={locked || !enabled.photos} onChange={(event) => setMinimumDate(event.target.value)} /></label>}
            <Status value={statuses.photos} />
        </div>
        <h4>Персональна інформація</h4>
        {fields.map(([key, label, inputs]) => <div className="personal-action-card" key={key}>
            <div className="personal-card-heading">{toggle(key, label)}{key !== "bio" && <small>API для фанпейджі ще не підключено</small>}</div>
            <div className="fanpage-edit-fields">{inputs.map(([field, title]) => <label className="field" key={field}><span>{title}</span>
                {key === "bio" ? <textarea aria-label={title} value={data[field] ?? ""} disabled={locked || !enabled[key]} onChange={(event) => update(field, event.target.value)} />
                    : <input aria-label={title} value={data[field] ?? ""} disabled={locked || !enabled[key]} onChange={(event) => update(field, event.target.value)} />}
            </label>)}</div>
            {key === "bio" && <small>Порожнє поле очищає біо.</small>}<Status value={statuses[key]} />
        </div>)}
        <div className="personal-action-card"><div className="personal-inline-actions">
            <button type="button" className="primary-button" disabled={!session || locked || Boolean(passwordRequest)} onClick={runAll}>Застосувати вибрані зміни</button>
            <button type="button" className="secondary-button" disabled={busy !== "fanpage.edit.batch"} onClick={stopBatch}><Square size={15} />Зупинити</button>
        </div><Status value={statuses.batch} /></div>
        {passwordRequest && <div className="overlay" onMouseDown={(event) => event.stopPropagation()}>
            <form className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-password-title" onSubmit={(event) => { event.preventDefault(); if (password && !locked) void changeName(password); }}>
                <h2 id="edit-password-title">Не вказано пароль Facebook</h2><p>Введіть пароль для підтвердження зміни назви фанпейджі.</p>
                <label className="field"><span>Пароль Facebook</span><input type="password" autoFocus autoComplete="off" value={password} disabled={locked} onChange={(event) => setPassword(event.target.value)} /></label>
                <div className="modal-actions"><button type="button" className="secondary-button" disabled={locked} onClick={() => { setPasswordRequest(null); setPassword(""); status("name", "pending", "Скасовано"); }}>Скасувати</button>
                    <button type="submit" className="primary-button" disabled={locked || !password}>Змінити назву</button></div>
            </form>
        </div>}
    </section>;
}
