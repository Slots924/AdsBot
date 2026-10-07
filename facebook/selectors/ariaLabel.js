/** Формує селектор текстових атрибутів без урахування ASCII-регістру. */
export default function ariaLabelSelector(base, labels) {
    return labels.map((label) => {
        const escaped = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${base}[aria-label="${escaped}" i]`;
    }).join(", ");
}
