import { useState } from "react";
import { X } from "lucide-react";

import ProxyStrip from "./ProxyStrip.jsx";


export default function WorkerProxyPicker({
    workerId,
    proxies,
    proxiesLoading,
    excludedIds = [],
    selectedId = null,
    onCreate,
    onUpdate,
    onDelete,
    onGet,
    onCheck,
    onCheckConfig,
    onRefreshIp,
    onError,
    onConfirm,
    onClose,
}) {
    const [selected, setSelected] = useState(selectedId);
    const available = proxies.filter((proxy) => proxy.type !== "no_proxy");

    return (
        <div
            className="overlay worker-proxy-picker-overlay"
            onMouseDown={(event) => {
                event.stopPropagation();
                onClose();
            }}
        >
            <div
                className="modal worker-proxy-picker-modal"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button className="modal-close" type="button" onClick={onClose}>
                    <X size={17} />
                </button>
                <span className="eyebrow">Воркер {workerId}</span>
                <h2>Оберіть проксі</h2>
                <p>Проксі, які вже стоять на інших воркерах, тут не показуються. Після відкриття одразу перевіряємо всі.</p>
                <ProxyStrip
                    variant="picker"
                    proxies={available}
                    loading={proxiesLoading}
                    excludedIds={excludedIds}
                    selectable
                    selectedId={selected}
                    autoCheck
                    onSelect={setSelected}
                    onCreate={onCreate}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onGet={onGet}
                    onCheck={onCheck}
                    onCheckConfig={onCheckConfig}
                    onRefreshIp={onRefreshIp}
                    onError={onError}
                />
                <div className="form-actions">
                    <button className="secondary-button" type="button" onClick={onClose}>
                        Скасувати
                    </button>
                    <button
                        className="primary-button"
                        type="button"
                        disabled={!selected}
                        onClick={() => onConfirm(selected)}
                    >
                        ОК
                    </button>
                </div>
            </div>
        </div>
    );
}
