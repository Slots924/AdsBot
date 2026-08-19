import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
    Copy,
    FilePenLine,
    LayoutTemplate,
    LoaderCircle,
    Plus,
    Trash2,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const emptyDraft = { name: "", pixel: "" };


function formatUpdatedAt(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("uk-UA", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(value));
}


export default function TemplatesTab({ onError, showToast }) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [editor, setEditor] = useState(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            setTemplates(await unwrap(window.adsBot.getTemplates()));
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося завантажити шаблони",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const openCreate = () => {
        setDraft(emptyDraft);
        setEditor({ mode: "create" });
    };

    const openEdit = (template) => {
        setDraft({ name: template.name, pixel: template.pixel });
        setEditor({ mode: "edit", id: template.id });
    };

    const save = async (event) => {
        event.preventDefault();
        if (!draft.name.trim() || saving) return;

        setSaving(true);
        try {
            const saved = editor.mode === "edit"
                ? await unwrap(window.adsBot.updateTemplate(editor.id, draft))
                : await unwrap(window.adsBot.createTemplate(draft));
            setTemplates((current) => editor.mode === "edit"
                ? current.map((item) => item.id === saved.id ? saved : item)
                : [...current, saved]);
            setEditor(null);
            showToast(
                editor.mode === "edit"
                    ? `Шаблон ID ${saved.id} оновлено`
                    : `Створено шаблон ID ${saved.id}`,
                "success"
            );
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося зберегти шаблон",
            });
        } finally {
            setSaving(false);
        }
    };

    const duplicate = async (event, template) => {
        event.stopPropagation();
        setBusyId(template.id);
        try {
            const copy = await unwrap(window.adsBot.duplicateTemplate(template.id));
            setTemplates((current) => [...current, copy]);
            showToast(`Створено копію з ID ${copy.id}`, "success");
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося дублювати шаблон",
            });
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (event, template) => {
        event.stopPropagation();
        if (!window.confirm(`Видалити шаблон «${template.name}» (ID ${template.id})?`)) {
            return;
        }

        setBusyId(template.id);
        try {
            await unwrap(window.adsBot.deleteTemplate(template.id));
            setTemplates((current) => current.filter(
                (item) => item.id !== template.id
            ));
            showToast(`Шаблон ID ${template.id} видалено`, "success");
        } catch (error) {
            onError({
                ...errorDetails(error),
                title: "Не вдалося видалити шаблон",
            });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <motion.section className="tab-content templates-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="page-heading split">
                <div>
                    <span className="eyebrow">Campaign presets</span>
                    <h1>Шаблони кампаній</h1>
                    <p>Локальні заготовки не прив’язані до Facebook-акаунтів.</p>
                </div>
                <button className="primary-button templates-create" onClick={openCreate}>
                    <Plus size={17} /> Створити шаблон
                </button>
            </div>

            <div className="templates-table-card">
                <div className="templates-table-head templates-grid">
                    <span>ID</span>
                    <span>Назва</span>
                    <span>Pixel</span>
                    <span>Оновлено</span>
                    <span>Дії</span>
                </div>

                {loading && (
                    <div className="templates-empty">
                        <LoaderCircle className="spin" size={23} />
                        Завантажуємо шаблони…
                    </div>
                )}

                {!loading && templates.length === 0 && (
                    <div className="templates-empty">
                        <LayoutTemplate size={31} />
                        <strong>Шаблонів ще немає</strong>
                        <span>Створіть перший шаблон рекламної кампанії.</span>
                    </div>
                )}

                {!loading && templates.map((template) => (
                    <div
                        key={template.id}
                        className="template-row templates-grid"
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(template)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                openEdit(template);
                            }
                        }}
                    >
                        <span className="template-id">
                            <i className="status-dot active" />
                            {template.id}
                        </span>
                        <strong>{template.name}</strong>
                        <span className={template.pixel ? "" : "muted-value"}>
                            {template.pixel || "Не вказано"}
                        </span>
                        <time>{formatUpdatedAt(template.updatedAt)}</time>
                        <span className="template-actions">
                            <button
                                className="icon-button"
                                title="Дублювати"
                                disabled={busyId === template.id}
                                onClick={(event) => duplicate(event, template)}
                            >
                                {busyId === template.id
                                    ? <LoaderCircle className="spin" size={15} />
                                    : <Copy size={15} />}
                            </button>
                            <button
                                className="icon-button danger"
                                title="Видалити"
                                disabled={busyId === template.id}
                                onClick={(event) => remove(event, template)}
                            >
                                <Trash2 size={15} />
                            </button>
                        </span>
                    </div>
                ))}
            </div>

            {editor && (
                <div className="overlay template-editor-overlay" onMouseDown={() => !saving && setEditor(null)}>
                    <motion.form
                        className="modal template-editor"
                        initial={{ opacity: 0, y: 20, scale: .97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onSubmit={save}
                    >
                        <button className="modal-close" type="button" disabled={saving} onClick={() => setEditor(null)}>
                            <X size={17} />
                        </button>
                        <div className="modal-icon template-icon"><FilePenLine /></div>
                        <span className="eyebrow">
                            {editor.mode === "edit" ? `Template ID ${editor.id}` : "New template"}
                        </span>
                        <h2>{editor.mode === "edit" ? "Редагувати шаблон" : "Новий шаблон"}</h2>
                        <p>Ці дані зберігаються локально в папці data.</p>
                        <div className="template-editor-fields">
                            <label className="field">
                                <span>Назва</span>
                                <input
                                    autoFocus
                                    value={draft.name}
                                    onChange={(event) => setDraft((current) => ({
                                        ...current,
                                        name: event.target.value,
                                    }))}
                                    placeholder="Наприклад, AT Slot"
                                />
                            </label>
                            <label className="field">
                                <span>Pixel <small>необов’язково</small></span>
                                <input
                                    value={draft.pixel}
                                    onChange={(event) => setDraft((current) => ({
                                        ...current,
                                        pixel: event.target.value,
                                    }))}
                                    placeholder="Pixel ID або назва"
                                />
                            </label>
                        </div>
                        <div className="form-actions">
                            <button className="secondary-button" type="button" disabled={saving} onClick={() => setEditor(null)}>
                                Скасувати
                            </button>
                            <button className="primary-button" type="submit" disabled={!draft.name.trim() || saving}>
                                {saving && <LoaderCircle className="spin" size={16} />}
                                {editor.mode === "edit" ? "Зберегти зміни" : "Створити шаблон"}
                            </button>
                        </div>
                    </motion.form>
                </div>
            )}
        </motion.section>
    );
}
