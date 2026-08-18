import { useState } from "react";
import { ImagePlus, X } from "lucide-react";


export default function ImageDropzone({ value, onChange, disabled }) {
    const [dragging, setDragging] = useState(false);

    const chooseImage = async () => {
        const response = await window.adsBot.selectImage();
        if (response.ok && response.data) {
            onChange(response.data);
        }
    };

    const handleDrop = (event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];

        if (file) {
            onChange(window.adsBot.getDroppedFilePath(file));
        }
    };

    return (
        <div
            className={`dropzone ${dragging ? "dragging" : ""} ${value ? "has-file" : ""}`}
            onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <ImagePlus size={25} />
            {value ? (
                <div className="dropzone-copy">
                    <strong>{value.split(/[\\/]/).pop()}</strong>
                    <span title={value}>{value}</span>
                </div>
            ) : (
                <div className="dropzone-copy">
                    <strong>Перетягніть картинку сюди</strong>
                    <span>JPG, JPEG, PNG або WEBP</span>
                </div>
            )}
            <button type="button" className="secondary-button" disabled={disabled} onClick={chooseImage}>
                Вибрати файл
            </button>
            {value && (
                <button type="button" className="icon-button" onClick={() => onChange("")}>
                    <X size={16} />
                </button>
            )}
        </div>
    );
}
