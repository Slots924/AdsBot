// Ідентифікатори мов для targeting.locales у Meta Marketing API.
// Значення відповідають мовам, які доступні для вибору в Meta Ads.
const languages = [
    { id: 4, code: "fr", name: "Французька" },
    { id: 5, code: "de", name: "Німецька" },
    { id: 6, code: "en", name: "Англійська" },
    { id: 7, code: "es", name: "Іспанська" },
    { id: 8, code: "it", name: "Італійська" },
    { id: 9, code: "pt", name: "Португальська" },
    { id: 10, code: "zh", name: "Китайська" },
    { id: 12, code: "ru", name: "Російська" },
    { id: 28, code: "ar", name: "Арабська" },
    { id: 31, code: "cs", name: "Чеська" },
    { id: 32, code: "da", name: "Данська" },
    { id: 33, code: "nl", name: "Нідерландська" },
    { id: 34, code: "fi", name: "Фінська" },
    { id: 35, code: "el", name: "Грецька" },
    { id: 36, code: "he", name: "Іврит" },
    { id: 37, code: "hi", name: "Гінді" },
    { id: 41, code: "hu", name: "Угорська" },
    { id: 42, code: "id", name: "Індонезійська" },
    { id: 43, code: "ja", name: "Японська" },
    { id: 44, code: "ko", name: "Корейська" },
    { id: 45, code: "ms", name: "Малайська" },
    { id: 46, code: "no", name: "Норвезька" },
    { id: 47, code: "pl", name: "Польська" },
    { id: 48, code: "ro", name: "Румунська" },
    { id: 49, code: "sk", name: "Словацька" },
    { id: 50, code: "sl", name: "Словенська" },
    { id: 51, code: "sv", name: "Шведська" },
    { id: 52, code: "th", name: "Тайська" },
    { id: 53, code: "tr", name: "Турецька" },
    { id: 54, code: "uk", name: "Українська" },
    { id: 55, code: "vi", name: "В'єтнамська" },
];

const searchAliases = Object.freeze({
    fr: ["french", "français"],
    de: ["german", "deutsch"],
    en: ["english"],
    es: ["spanish", "español"],
    it: ["italian", "italiano"],
    pt: ["portuguese", "português"],
    zh: ["chinese", "中文"],
    ru: ["russian", "русский"],
    ar: ["arabic", "العربية"],
    cs: ["czech", "čeština"],
    da: ["danish", "dansk"],
    nl: ["dutch", "nederlands"],
    fi: ["finnish", "suomi"],
    el: ["greek", "ελληνικά"],
    he: ["hebrew", "עברית"],
    hi: ["hindi", "हिन्दी"],
    hu: ["hungarian", "magyar"],
    id: ["indonesian", "bahasa indonesia"],
    ja: ["japanese", "日本語"],
    ko: ["korean", "한국어"],
    ms: ["malay", "bahasa melayu"],
    no: ["norwegian", "norsk"],
    pl: ["polish", "polski"],
    ro: ["romanian", "română"],
    sk: ["slovak", "slovenčina"],
    sl: ["slovenian", "slovenščina"],
    sv: ["swedish", "svenska"],
    th: ["thai", "ไทย"],
    tr: ["turkish", "türkçe"],
    uk: ["ukrainian", "українська"],
    vi: ["vietnamese", "tiếng việt"],
});

export const SUPPORTED_TEMPLATE_LANGUAGES = Object.freeze(languages.map(
    (language) => ({ ...language, aliases: searchAliases[language.code] ?? [] })
));
export const SUPPORTED_TEMPLATE_LANGUAGE_IDS = new Set(
    languages.map((language) => language.id)
);

export default class LanguageCatalog {
    async list() {
        return SUPPORTED_TEMPLATE_LANGUAGES.map((language) => ({
            ...language,
            aliases: [...language.aliases],
        }));
    }
}
