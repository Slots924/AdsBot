import { useState } from "react";
import { FolderOpen, X } from "lucide-react";

import MultiSelect from "./MultiSelect.jsx";
import { errorDetails, unwrap } from "../lib/api.js";


export default function CreateCommentAccountsModal({
    profiles,
    groups,
    settings,
    onClose,
    onQueued,
    onError,
}) {
    const [draft, setDraft] = useState({
        geo: "",
        maleCount: String(profiles.length),
        femaleCount: "0",
        excludedGroupIds: [],
        photosDirectory: "",
    });
    const [saving, setSaving] = useState(false);
    const geo = String(draft.geo ?? "").replace(/\s+/g, " ").trim();
    const maleCount = Number(draft.maleCount);
    const femaleCount = Number(draft.femaleCount);
    const canSubmit = geo.length > 0
        && Number.isInteger(maleCount)
        && Number.isInteger(femaleCount)
        && maleCount >= 0
        && femaleCount >= 0
        && maleCount + femaleCount > 0
        && draft.photosDirectory;

    const chooseFolder = async () => {
        try {
            const selected = await unwrap(
                window.adsBot.selectAccountPhotosFolder()
            );
            if (selected) {
                setDraft((current) => ({
                    ...current,
                    photosDirectory: selected,
                }));
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
                maleCount,
                femaleCount,
                excludedGroupIds: draft.excludedGroupIds,
                photosDirectory: draft.photosDirectory,
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
                        <input
                            value={draft.geo}
                            maxLength={80}
                            placeholder="поляки"
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                geo: event.target.value,
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
                <label className="field">
                    <span>Групи з іменами для виключення</span>
                    <MultiSelect
                        items={groups}
                        value={draft.excludedGroupIds}
                        onChange={(excludedGroupIds) => setDraft((current) => ({
                            ...current,
                            excludedGroupIds,
                        }))}
                        placeholder="Оберіть групи AdsPower"
                        searchPlaceholder="Назва або ID групи…"
                    />
                </label>
                <label className="field">
                    <span>Папка з фото</span>
                    <div className="inline-field">
                        <input
                            readOnly
                            value={draft.photosDirectory}
                            placeholder="Оберіть папку…"
                        />
                        <button
                            type="button"
                            className="secondary-button"
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
