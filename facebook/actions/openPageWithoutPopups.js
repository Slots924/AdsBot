async function openPageWithoutPopups(
    page,
    url,
    navigationOptions = {}
) {
    // Блокуємо Credential Management API до завантаження Facebook
    await page.evaluateOnNewDocument(() => {
        try {
            delete Object.getPrototypeOf(navigator).credentials;
        } catch {}
    });

    await page.goto(url, {
        waitUntil: "domcontentloaded",
        ...navigationOptions,
    });
}


export default openPageWithoutPopups;
