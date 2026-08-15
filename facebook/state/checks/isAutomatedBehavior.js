export const automatedBehaviorTexts = [
    "We suspect automated behavior on your account",
    "Wir vermuten automatisiertes Verhalten auf Ihrem Konto",
    "Wir vermuten automatisiertes Verhalten auf deinem Konto",
    "Nous suspectons un comportement automatisé sur votre compte",
    "Sospechamos que hay un comportamiento automatizado en tu cuenta",
    "Sospechamos actividad automatizada en tu cuenta",
    "Ми підозрюємо автоматизовану поведінку у вашому обліковому записі",
    "Ми підозрюємо автоматизовану поведінку у вашому акаунті",
    "Мы подозреваем автоматизированное поведение в вашем аккаунте",
    "Мы подозреваем автоматическое поведение в вашем аккаунте",
    "हमें आपके अकाउंट पर ऑटोमेटेड व्यवहार का संदेह है",
    "हमें आपके खाते पर स्वचालित व्यवहार का संदेह है",
    "Hesabında otomatik davranışlar olduğundan şüpheleniyoruz",
];


export default async function isAutomatedBehavior(page) {
    const currentUrl = page.url();

    if (!currentUrl.includes("www.facebook.com/checkpoint")) {
        return false;
    }

    return page.evaluate((textsByLanguage) => {
        const normalizeText = (text) => String(text ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase()
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .replace(/ı/g, "i");

        return Array.from(
            document.querySelectorAll("span")
        ).some((span) => {
            const spanText = normalizeText(span.textContent);

            return textsByLanguage.some((text) =>
                spanText.includes(normalizeText(text))
            );
        });
    }, automatedBehaviorTexts);
}
