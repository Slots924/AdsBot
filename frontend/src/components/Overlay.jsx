import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";


export function Modal({ modal, onClose }) {
    return (
        <AnimatePresence>
            {modal && (
                <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.div className="modal" initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}>
                        <button className="modal-close" onClick={onClose}><X size={17} /></button>
                        <div className={`modal-icon ${modal.type || "error"}`}>
                            {modal.type === "success" ? <CheckCircle2 /> : <AlertTriangle />}
                        </div>
                        <span className="eyebrow">{modal.code || (modal.type === "success" ? "Успішно" : "Помилка")}</span>
                        <h2>{modal.title}</h2>
                        <p>{modal.message}</p>
                        {modal.details && <div className="modal-details">{modal.details}</div>}
                        <button className="primary-button" onClick={onClose}>Зрозуміло</button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}


export function Toast({ toast }) {
    return (
        <AnimatePresence>
            {toast && (
                <motion.div className={`toast ${toast.type || "info"}`} initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }}>
                    {toast.message}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
