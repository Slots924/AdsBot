import { useEffect, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, ImagePlus, Trash2 } from "lucide-react";

function fileName(path) {
    return String(path ?? "").split(/[\\/]/).pop() || "Фото";
}

function ImageRow({ path, index, disabled, onRemove }) {
    const controls = useDragControls();
    const [preview, setPreview] = useState("");
    useEffect(() => {
        let active = true;
        window.adsBot.getImagePreview(path).then((result) => {
            if (active && result.ok) setPreview(result.data);
        }).catch(() => {});
        return () => { active = false; };
    }, [path]);
    return <Reorder.Item value={path} dragListener={false} dragControls={controls} drag="y" className="post-image-item" whileDrag={{ scale: 1.02, zIndex: 2 }}>
        <button type="button" className="post-image-drag-handle" aria-label={`Перетягнути ${fileName(path)}`} disabled={disabled} onPointerDown={(event) => controls.start(event)}><GripVertical size={16} /></button>
        <span className="post-image-position">{index + 1}</span>
        {preview ? <img src={preview} alt={fileName(path)} /> : <span className="post-image-preview-placeholder"><ImagePlus size={18} /></span>}
        <strong title={path}>{fileName(path)}</strong>
        <button type="button" className="icon-button danger" disabled={disabled} aria-label={`Видалити ${fileName(path)}`} onClick={() => onRemove(path)}><Trash2 size={16} /></button>
    </Reorder.Item>;
}

export default function ImageListDropzone({ value = [], onChange, disabled }) {
    const paths = Array.isArray(value) ? value : [];
    const addPaths = (nextPaths) => onChange([...new Set([...paths, ...nextPaths.map((path) => String(path ?? "").trim()).filter(Boolean)])]);
    const chooseImages = async () => {
        const response = await window.adsBot.selectImages();
        if (response.ok && Array.isArray(response.data)) addPaths(response.data);
    };
    return <div>
        <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            if (disabled) return;
            addPaths([...event.dataTransfer.files].map((file) => window.adsBot.getDroppedFilePath(file)));
        }}>
            <ImagePlus size={25} />
            <div className="dropzone-copy"><strong>Перетягніть картинку сюди</strong><span>Можна вибрати дві або більше. Порядок нижче буде порядком у Facebook.</span></div>
            <button type="button" className="secondary-button" disabled={disabled} onClick={chooseImages}>Вибрати фото</button>
        </div>
        {paths.length > 0 && <Reorder.Group as="div" axis="y" values={paths} onReorder={onChange} className="post-image-list" aria-label="Вибрані фотографії">
            {paths.map((path, index) => <ImageRow key={path} path={path} index={index} disabled={disabled} onRemove={(removed) => onChange(paths.filter((item) => item !== removed))} />)}
        </Reorder.Group>}
    </div>;
}
