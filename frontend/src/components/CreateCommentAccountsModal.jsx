import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";

import GeoSelect from "./GeoSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


export default function CreateCommentAccountsModal({
    profiles,
    settings,
    lastPhotosDirectory = "",
    onPhotosDirectoryChange = () => {},
    onClose,
    onQueued,
    onError,
}) {
    const [countries, setCountries] = useState([]);
    const [draft, setDraft] = useState({
        geo: "",
        namesGeo: "",
        companiesGeo: "",
        universitiesGeo: "",
        professionsGeo: "",
        maleCount: String(profiles.length),
        femaleCount: "0",
        photosDirectory: "",
        operations: {
            changeName: true,
            changeAvatar: true,
            changeCover: true,
            deletePosts: true,
            publishPosts: true,
            fillAbout: true,
        },
    });
    const [saving, setSaving] = useState(false);
    const geo = String(draft.geo ?? "").trim().toUpperCase();
    const maleCount = Number(draft.maleCount);
    const femaleCount = Number(draft.femaleCount);
    const needsPhotos = draft.operations.changeAvatar
        || draft.operations.changeCover
        || draft.operations.publishPosts;
    const canSubmit = /^[A-Z]{2}$/.test(geo)
        && Number.isInteger(maleCount)
        && Number.isInteger(femaleCount)
        && maleCount >= 0
        && femaleCount >= 0
        && maleCount + femaleCount > 0
        && (!needsPhotos || draft.photosDirectory);

    const setOperation = (operation, enabled) => {
        setDraft((current) => ({
            ...current,
            operations: {
                ...current.operations,
                [operation]: enabled,
            },
        }));
    };

    useEffect(() => {
        unwrap(window.adsBot.getCountries()).then(setCountries).catch(() => {});
    }, []);

    const chooseFolder = async () => {
        try {
            const selected = await unwrap(
                window.adsBot.selectAccountPhotosFolder(lastPhotosDirectory)
            );
            if (selected) {
                setDraft((current) => ({
                    ...current,
                    photosDirectory: selected,
                }));
                onPhotosDirectoryChange(selected);
            }
        } catch (error) {
            onError(errorDetails(error));
        }
    };

    const submit = async (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSaving(true);
        try {
            onQueued(await unwrap(window.adsBot.runCommentAccountSetup({
                profileNos: profiles.map((item) => item.profileNo),
                geo,
                namesGeo: draft.namesGeo || geo,
                companiesGeo: draft.companiesGeo || geo,
                universitiesGeo: draft.universitiesGeo || geo,
                professionsGeo: draft.professionsGeo || geo,
                maleCount,
                femaleCount,
                photosDirectory: draft.photosDirectory,
                operations: draft.operations,
                browserMode: settings.accountSetupBrowserMode,
                commentWorkerConcurrency: settings.accountSetupWorkerConcurrency,
                commentWorkerProxyIds: settings.accountSetupWorkerProxyIds,
            })));
        } catch (error) {
            onError(errorDetails(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overlay">
            <form className="modal action-modal account-setup-modal" onSubmit={submit}>
                <button type="button" className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">AdsPower setup</span>
                <h2>Створити акаунти під коментарі</h2>
                <p className="account-setup-selected">
                    Вибрано профілів: {profiles.length}
                </p>
                <div className="account-setup-list">
                    {profiles.map((profile) => (
                        <span key={profile.profileId}>
                            {profile.profileNo} · {profile.name || "Без назви"}
                        </span>
                    ))}
                </div>
                <div className="creative-fields-row">
                    <label className="field geo-field">
                        <span>Цільова країна</span>
                        <GeoSelect
                            layout="list"
                            countries={countries}
                            value={draft.geo}
                            placeholder="Оберіть країну"
                            ariaLabel="Цільова країна"
                            onChange={(nextGeo) => setDraft((current) => ({
                                ...current,
                                geo: nextGeo,
                            }))}
                        />
                    </label>
                    <label className="field">
                        <span>Чоловічих</span>
                        <input
                            type="number"
                            min="0"
                            value={draft.maleCount}
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                maleCount: event.target.value,
                            }))}
                        />
                    </label>
                    <label className="field">
                        <span>Жіночих</span>
                        <input
                            type="number"
                            min="0"
                            value={draft.femaleCount}
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                femaleCount: event.target.value,
                            }))}
                        />
                    </label>
                </div>
                <details className="account-setup-advanced">
                    <summary>Розширені налаштування</summary>
                    <section className="account-setup-operations">
                        <strong>Дії над Facebook-профілем</strong>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.changeName} onChange={(event) => setOperation("changeName", event.target.checked)} /><span>Змінити ім’я Facebook</span></label>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.changeAvatar} onChange={(event) => setOperation("changeAvatar", event.target.checked)} /><span>Змінити аватарку</span></label>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.changeCover} onChange={(event) => setOperation("changeCover", event.target.checked)} /><span>Змінити обкладинку</span></label>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.deletePosts} onChange={(event) => setOperation("deletePosts", event.target.checked)} /><span>Видалити старі пости</span></label>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.publishPosts} onChange={(event) => setOperation("publishPosts", event.target.checked)} /><span>Опублікувати фото-пости</span></label>
                        <label className="checkbox-line compact"><input type="checkbox" checked={draft.operations.fillAbout} onChange={(event) => setOperation("fillAbout", event.target.checked)} /><span>Заповнити інформацію About</span></label>
                    </section>
                    <p className="settings-hint">Якщо поле країни не вибране, використовується цільова країна.</p>
                    <div className="form-grid">
                        <label className="field">
                            <span>Імена</span>
                            <GeoSelect disabled={!draft.operations.changeName} layout="list" countries={countries} value={draft.namesGeo} placeholder={geo || "Як цільова країна"} ariaLabel="Країна для імен" onChange={(value) => setDraft((current) => ({ ...current, namesGeo: value }))} />
                        </label>
                        <label className="field">
                            <span>Компанії</span>
                            <GeoSelect disabled={!draft.operations.fillAbout} layout="list" countries={countries} value={draft.companiesGeo} placeholder={geo || "Як цільова країна"} ariaLabel="Країна для компаній" onChange={(value) => setDraft((current) => ({ ...current, companiesGeo: value }))} />
                        </label>
                        <label className="field">
                            <span>Професії</span>
                            <GeoSelect disabled={!draft.operations.fillAbout} layout="list" countries={countries} value={draft.professionsGeo} placeholder={geo || "Як цільова країна"} ariaLabel="Країна для професій" onChange={(value) => setDraft((current) => ({ ...current, professionsGeo: value }))} />
                        </label>
                        <label className="field">
                            <span>Навчання</span>
                            <GeoSelect disabled={!draft.operations.fillAbout} layout="list" countries={countries} value={draft.universitiesGeo} placeholder={geo || "Як цільова країна"} ariaLabel="Країна для навчання" onChange={(value) => setDraft((current) => ({ ...current, universitiesGeo: value }))} />
                        </label>
                    </div>
                </details>
                <label className="field">
                    <span>Папка з фото{needsPhotos ? "" : " (не потрібна)"}</span>
                    <div className="inline-field">
                        <input
                            readOnly
                            value={draft.photosDirectory}
                            placeholder={needsPhotos ? "Оберіть папку…" : "Фото-дії вимкнені"}
                        />
                        <button
                            type="button"
                            className="secondary-button"
                            disabled={!needsPhotos}
                            onClick={chooseFolder}
                        >
                            <FolderOpen size={15} /> Вибрати папку
                        </button>
                    </div>
                </label>
                <small className="settings-hint account-setup-hint">
                    У папці мають бути каталоги Man і Woman. Всередині — окрема
                    папка на набір фото. Файл 1 — аватар, 2 — обкладинка
                    (JPG, JPEG, PNG, WEBP). Решта фото йдуть у пости. Після
                    успіху папка стає AdsPower_номер.
                </small>
                <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button className="primary-button" disabled={!canSubmit || saving}>
                        У чергу
                    </button>
                </div>
            </form>
        </div>
    );
}
