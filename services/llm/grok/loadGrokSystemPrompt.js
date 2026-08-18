import { readFile } from "node:fs/promises";
import path from "node:path";


function createPromptError(message) {
    const error = new Error(message);
    error.code = "GROK_CONFIG_ERROR";
    return error;
}


/**
 * Завантажує системний prompt Grok із текстового файла.
 * @param {string} filePath Шлях до UTF-8 файла.
 * @returns {Promise<string>}
 * @throws {Error} GROK_CONFIG_ERROR, якщо файл відсутній або порожній.
 */
export default async function loadGrokSystemPrompt(
    filePath = "./data/prompts/grok/system.txt"
) {
    const absolutePath = path.resolve(filePath);
    let content;

    try {
        content = await readFile(absolutePath, "utf8");
    } catch {
        throw createPromptError(
            `Не вдалося прочитати system prompt "${absolutePath}"`
        );
    }

    const systemPrompt = content.trim();

    if (!systemPrompt) {
        throw createPromptError("System prompt Grok порожній");
    }

    return systemPrompt;
}
