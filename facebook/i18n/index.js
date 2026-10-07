import en from "./en.js";
import uk from "./uk.js";
import ru from "./ru.js";
import de from "./de.js";
import fr from "./fr.js";
import es from "./es.js";
import hi from "./hi.js";
import tr from "./tr.js";
import id from "./id.js";

export const facebookTranslations = Object.freeze({ en, uk, ru, de, fr, es, hi, tr, id });
export const supportedFacebookLanguages = Object.freeze(Object.keys(facebookTranslations));

/** Повертає всі мовні варіанти ключа незалежно від поточної мови сторінки. */
export function getFacebookTexts(key) {
    const variants = supportedFacebookLanguages.flatMap((language) => {
        const value = key.split(".").reduce((entry, part) => entry?.[part], facebookTranslations[language]);
        if (!Array.isArray(value) || value.length === 0 || value.some((text) => typeof text !== "string" || !text.trim())) {
            throw new Error(`Відсутні мовні варіанти Facebook: ${language}.${key}`);
        }
        return value;
    });
    return [...new Set(variants)];
}
