import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from "lucide-react";


function fileName(path) {
    return String(path ?? "").split(/[\\/]/).pop() || "Фото";
}


export default function ImageListDropzone({ value = [], onChange, disabled }) {
    const paths = Array.isArray(value) ? value : [];
    const addPaths = (nextPaths) => {
        onChange([...new Set([
            ...paths,
            ...nextPaths.map((path) => String(path ?? "").trim()).filter(Boolean),
        ])]);
    };
    const chooseImages = async () => {
        const response = await window.adsBot.selectImages();
        if (response.ok && Array.isArray(response.data)) addPaths(response.data);
    };
    const move = (index, offset) => {
        const target = index + offset;
        if (target < 0 || target >= paths.length) return;
        const next = [...paths];
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    return <div>
        <div
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                addPaths([...event.dataTransfer.files].map(
                    (file) => window.adsBot.getDroppedFilePath(file)
                ));
            }}
        >
            <ImagePlus size={25} />
            <div className="dropzone-copy">
                <strong>Перетягніть картинку сюди</strong>
                <span>Можна вибрати дві або більше. Порядок нижче буде порядком у Facebook.</span>
            </div>
            <button type="button" className="secondary-button" disabled={disabled} onClick={chooseImages}>
                Вибрати фото
            </button>
        </div>
        {paths.length > 0 && <div className="post-image-list" aria-label="Вибрані фотографії">
            {paths.map((path, index) => <div className="post-image-item" key={path}>
                <span className="post-image-position">{index + 1}</span>
                <img src={`file:///${encodeURI(String(path).replace(/\\/g, "/"))}`} alt={fileName(path)} />
                <strong title={path}>{fileName(path)}</strong>
                <div>
                    <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Перемістити ${fileName(path)} ліворуч`} onClick={() => move(index, -1)}><ArrowLeft size={16} /></button>
                    <button type="button" className="icon-button" disabled={disabled || index === paths.length - 1} aria-label={`Перемістити ${fileName(path)} праворуч`} onClick={() => move(index, 1)}><ArrowRight size={16} /></button>
                    <button type="button" className="icon-button danger" disabled={disabled} aria-label={`Видалити ${fileName(path)}`} onClick={() => onChange(paths.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>
                </div>
            </div>)}
        </div>}
    </div>;
}
