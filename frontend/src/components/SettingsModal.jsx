import { motion } from "framer-motion";
import { ListChecks, Minus, Plus, RotateCcw, Settings, X, ZoomIn } from "lucide-react";


const minimumScale = 80;
const maximumScale = 150;
const scaleStep = 10;


export default function SettingsModal({
    scale,
    onScaleChange,
    createCampaignsPaused,
    onCreateCampaignsPausedChange,
    commentTaskConcurrency,
    onCommentTaskConcurrencyChange,
    commentBrowserMode,
    onCommentBrowserModeChange,
    commentDisableImages,
    onCommentDisableImagesChange,
    onClose,
}) {
    const percentage = Math.round(scale * 100);
    const change = (nextPercentage) => {
        const normalized = Math.min(
            maximumScale,
            Math.max(minimumScale, nextPercentage)
        );
        onScaleChange(normalized / 100);
    };

    return (
        <div className="overlay" onMouseDown={onClose}>
            <motion.div
                className="modal settings-modal"
                initial={{ opacity: 0, y: 20, scale: .97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button className="modal-close" onClick={onClose}>
                    <X size={17} />
                </button>
                <div className="modal-icon settings-icon"><Settings /></div>
                <span className="eyebrow">AdsBot preferences</span>
                <h2>Налаштування</h2>
                <p>Зміни застосовуються одразу та зберігаються після закриття програми.</p>

                <section className="scale-setting">
                    <div className="scale-setting-heading">
                        <span><ZoomIn size={15} /> Масштаб інтерфейсу</span>
                        <strong>{percentage}%</strong>
                    </div>
                    <div className="scale-controls">
                        <button
                            className="icon-button"
                            disabled={percentage <= minimumScale}
                            onClick={() => change(percentage - scaleStep)}
                        >
                            <Minus size={15} />
                        </button>
                        <input
                            aria-label="Масштаб інтерфейсу"
                            type="range"
                            min={minimumScale}
                            max={maximumScale}
                            step={scaleStep}
                            value={percentage}
                            onChange={(event) => change(Number(event.target.value))}
                        />
                        <button
                            className="icon-button"
                            disabled={percentage >= maximumScale}
                            onClick={() => change(percentage + scaleStep)}
                        >
                            <Plus size={15} />
                        </button>
                    </div>
                    <div className="scale-labels">
                        <span>{minimumScale}%</span>
                        <span>{maximumScale}%</span>
                    </div>
                </section>

                <section className="scale-setting campaign-safety-setting">
                    <label className="checkbox-line">
                        <input
                            type="checkbox"
                            checked={createCampaignsPaused}
                            onChange={(event) => onCreateCampaignsPausedChange(
                                event.target.checked
                            )}
                        />
                        <span>
                            <strong>Залишати campaign на паузі</strong>
                            <small>Ad sets та ads будуть ACTIVE, але не витрачатимуть бюджет, доки campaign PAUSED.</small>
                        </span>
                    </label>
                </section>

                <section className="scale-setting">
                    <div className="scale-setting-heading">
                        <span><ListChecks size={15} /> Паралельні задачі коментування</span>
                        <strong>{commentTaskConcurrency}</strong>
                    </div>
                    <div className="scale-controls task-concurrency-controls">
                        <button className="icon-button" disabled={commentTaskConcurrency <= 1} onClick={() => onCommentTaskConcurrencyChange(commentTaskConcurrency - 1)}><Minus size={15} /></button>
                        <input aria-label="Паралельні задачі коментування" type="range" min="1" max="5" step="1" value={commentTaskConcurrency} onChange={(event) => onCommentTaskConcurrencyChange(Number(event.target.value))} />
                        <button className="icon-button" disabled={commentTaskConcurrency >= 5} onClick={() => onCommentTaskConcurrencyChange(commentTaskConcurrency + 1)}><Plus size={15} /></button>
                    </div>
                    <div className="scale-labels"><span>1</span><span>5</span></div>
                    <small className="settings-hint">Задачі з однаковими AdsPower-групами все одно чекатимуть одна одну.</small>
                </section>

                <section className="scale-setting comment-browser-setting">
                    <div className="scale-setting-heading">
                        <span>Браузер для коментарів</span>
                    </div>
                    <label className="field">
                        <span>Режим запуску AdsPower</span>
                        <select
                            aria-label="Режим браузера для коментарів"
                            value={commentBrowserMode}
                            onChange={(event) => onCommentBrowserModeChange(event.target.value)}
                        >
                            <option value="visible">Звичайний браузер</option>
                            <option value="headless">Headless (без вікна)</option>
                        </select>
                    </label>
                    <label className="checkbox-line">
                        <input
                            type="checkbox"
                            checked={commentDisableImages}
                            onChange={(event) => onCommentDisableImagesChange(event.target.checked)}
                        />
                        <span>
                            <strong>Не завантажувати зображення</strong>
                            <small>Економить трафік лише на зображеннях. Відео, шрифти та інші ресурси продовжують завантажуватися.</small>
                        </span>
                    </label>
                </section>

                <div className="form-actions settings-actions">
                    <button className="secondary-button" onClick={() => change(130)}>
                        <RotateCcw size={14} /> Повернути 130%
                    </button>
                    <button className="primary-button" onClick={onClose}>Готово</button>
                </div>
            </motion.div>
        </div>
    );
}
