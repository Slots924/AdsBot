function getRandomInteger(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


async function waitRandom(min, max) {
    const delay = getRandomInteger(min, max);

    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


async function humanClick(page, selector) {
    await page.waitForSelector(selector);

    const element = await page.$(selector);

    if (!element) {
        throw new Error(
            `Не знайдено елемент для кліку: ${selector}`
        );
    }

    try {
        await element.evaluate((target) => {
            target.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
            });
        });

        const box = await element.boundingBox();

        if (!box) {
            throw new Error(
                `Не вдалося визначити розташування елемента: ${selector}`
            );
        }

        // Обираємо випадкову точку подалі від країв елемента
        const x =
            box.x + box.width * (0.25 + Math.random() * 0.5);
        const y =
            box.y + box.height * (0.25 + Math.random() * 0.5);
        const steps = getRandomInteger(8, 18);

        await page.mouse.move(x, y, { steps });

        await waitRandom(60, 140);

        await page.mouse.down();

        await waitRandom(70, 160);

        await page.mouse.up();
    } finally {
        await element.dispose();
    }
}


async function ensureEnglish(page) {
    try {
        await page.goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
        });

        await waitRandom(879, 1354);

        const language = await page.$eval(
            'html[id="facebook"][lang]',
            (element) => element.getAttribute("lang")
        );

        if (language === "en") {
            return;
        }

        await page.goto(
            "https://www.facebook.com/settings/?tab=language",
            {
                waitUntil: "domcontentloaded",
            }
        );

        await waitRandom(6755, 8765);

        await humanClick(
            page,
            'div[role="main"] div[style^="border-radius"] div[class^="html-div"] div[role="button"]'
        );

        await waitRandom(6755, 8765);

        const dialogSelector =
            'div[aria-labelledby][role="dialog"]';

        await page.waitForSelector(dialogSelector, {
            visible: true,
        });

        const inputSelector =
            `${dialogSelector} input[placeholder][type="text"]`;

        await page.waitForSelector(inputSelector, {
            visible: true,
        });

        await page.type(inputSelector, "US", {
            delay: 300,
        });

        await waitRandom(1755, 3765);

        await humanClick(
            page,
            `${dialogSelector} div[data-visualcompletion="ignore-dynamic"] > div:nth-of-type(1)`
        );

        await waitRandom(6755, 8765);
    } catch {
        // Зміна мови не повинна зупиняти подальшу роботу програми
    }
}


export default ensureEnglish;
