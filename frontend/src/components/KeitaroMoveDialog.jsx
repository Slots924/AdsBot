import { useState } from "react";
import { LoaderCircle, MoveRight } from "lucide-react";

import { UiButton, UiModal, UiSelect } from "./shared-ui/index.js";


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
    return <UiModal title={title} description={`Вибрано елементів: ${count}`} onClose={onClose}>
        <div className="ui-move-dialog">
            <label><span>Нова група</span><UiSelect items={groups} value={groupId} onChange={(value) => setGroupId(String(value))} placeholder="Оберіть групу" searchPlaceholder="Пошук групи…" ariaLabel="Нова група" /></label>
            <div className="ui-modal-actions"><UiButton disabled={moving} onClick={onClose}>Скасувати</UiButton><UiButton variant="primary" disabled={moving || !groupId} onClick={submit}>{moving ? <LoaderCircle className="spin" size={16} /> : <MoveRight size={16} />} Перенести</UiButton></div>
        </div>
    </UiModal>;
}
