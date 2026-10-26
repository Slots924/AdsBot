import { MousePointer2, Code2, Zap, Diamond, Hexagon } from "lucide-react";

export const accountCreationTypes = {
    ui: { label: "ЮА", icon: MousePointer2 },
    api: { label: "API", icon: Code2 },
    autoupload: { label: "Автоаплоад", icon: Zap },
    reserved4: { label: "Тип 4", icon: Diamond },
    reserved5: { label: "Тип 5", icon: Hexagon },
};

export default function AccountCreationType({ type }) {
    const definition = accountCreationTypes[type];
    if (!definition) return <span className="creation-type-empty">—</span>;
    const Icon = definition.icon;
    return <span className={`creation-type-badge creation-type-${type}`} title={`Тип створення: ${definition.label}`}>
        <Icon size={14} aria-hidden="true" /><span>{definition.label}</span>
    </span>;
}
