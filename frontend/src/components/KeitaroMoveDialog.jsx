import { useState } from "react";
import { LoaderCircle, MoveRight } from "lucide-react";

import { GrayButton, GrayModal, GraySelect } from "./gray-ui/index.js";


export default function KeitaroMoveDialog({
    title,
    count,
    groups,
    onClose,
    onMove,
}) {
    const [groupId, setGroupId] = useState("");
    const [moving, setMoving] = useState(false);
    const submit = async () => {
        setMoving(true);
        try {
            await onMove(groupId);
        } finally {
            setMoving(false);
        }
    };
    return <GrayModal title={title} description={`Вибрано елементів: ${count}`} onClose={onClose}>
        <div className="kg-move-dialog">
            <label><span>Нова група</span><GraySelect items={groups} value={groupId} onChange={(value) => setGroupId(String(value))} placeholder="Оберіть групу" searchPlaceholder="Пошук групи…" ariaLabel="Нова група" /></label>
            <div className="kg-modal-actions"><GrayButton disabled={moving} onClick={onClose}>Скасувати</GrayButton><GrayButton variant="primary" disabled={moving || !groupId} onClick={submit}>{moving ? <LoaderCircle className="spin" size={16} /> : <MoveRight size={16} />} Перенести</GrayButton></div>
        </div>
    </GrayModal>;
}
