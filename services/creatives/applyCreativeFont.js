const blurryJoiner = "\u034F";
const urlPattern = /https?:\/\/[^\s<>"'`]+/giu;


/**
 * Застосовує Blurry Font до літер і цифр, не торкаючись URL у тексті.
 * Працює з будь-якою кількістю посилань у одному креативі.
 * @param {string} text Початковий текст креативу.
 * @returns {string} Текст із Blurry Font без змінених посилань.
 */
export function applyBlurryFont(text) {
    return Array.from(String(text ?? ""), (character) => (
        /[\p{L}\p{N}]/u.test(character)
            ? `${character}${blurryJoiner}`
            : character
    )).join("");
}


/**
 * Змінює лише фрагменти тексту поза HTTP/HTTPS-посиланнями.
 * @param {string} text Початковий текст.
 * @param {(part: string) => string} transform Перетворення звичайного тексту.
 * @returns {string} Перетворений текст із незмінними URL.
 */
export function transformTextExceptUrls(text, transform) {
    const source = String(text ?? "");
    const apply = typeof transform === "function" ? transform : (value) => value;
    let result = "";
    let offset = 0;

    for (const match of source.matchAll(urlPattern)) {
        const index = match.index ?? 0;
        result += apply(source.slice(offset, index));
        result += match[0];
        offset = index + match[0].length;
    }

    return result + apply(source.slice(offset));
}


/**
 * Застосовує вказаний шрифт до тексту креативу.
 * @param {string} text Початковий текст.
 * @param {string} font Ідентифікатор шрифту.
 * @returns {string} Текст у вибраному шрифті.
 */
export default function applyCreativeFont(text, font = "blurry") {
    if (font !== "blurry") return String(text ?? "");
    return transformTextExceptUrls(text, applyBlurryFont);
}
