import resolveCommentTarget from "./resolveCommentTarget.js";

export default function commentBatchInput({ postUrl, comments } = {}) {
    const target = resolveCommentTarget(String(postUrl ?? "").trim());
    const lines = (typeof comments === "string" ? comments.split(/\r?\n/) : comments);
    if (!Array.isArray(lines) || lines.some(line => typeof line !== "string")) throw new Error("Введіть коментарі, кожен з нового рядка");
    const normalized = lines.map(line => line.trim()).filter(Boolean);
    if (!normalized.length || normalized.length > 1000 || normalized.some(line => line.length > 8000 || /[\r\n]/.test(line))) {
        throw new Error("Вкажіть від 1 до 1000 коментарів, до 8000 символів у кожному");
    }
    return { ...target, comments: normalized };
}
