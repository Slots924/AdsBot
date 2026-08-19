import { motion } from "framer-motion";
import { Minus, Plus, RotateCcw, Settings, X, ZoomIn } from "lucide-react";


const minimumScale = 80;
const maximumScale = 150;
const scaleStep = 10;


export default function SettingsModal({ scale, onScaleChange, onClose }) {
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
