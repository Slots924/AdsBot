import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import { wait, waitHuman } from "../browser/timing.js";


export const dismissButtonLabels = [
    "Dismiss",
    "Close",
    "Schließen",
    "Verwerfen",
    "Fermer",
    "Ignorer",
    "Cerrar",
    "Descartar",
    "Закрити",
    "Відхилити",
    "Закрыть",
    "Отклонить",
    "बंद करें",
    "खारिज करें",
    "Kapat",
    "Reddet",
];


export default async function dismissAutomatedBehavior(page) {
    const buttonSelector =
        'button[aria-label], [role="button"][aria-label]';
    let buttonHandle;

    try {
        console.log("Шукаємо кнопку закриття automated behavior...");

        const buttonFoundHandle = await page.waitForFunction(
            (selector, labels) => {
                const normalizeText = (text) => String(text ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase()
                    .normalize("NFKD")
                    .replace(/\p{M}/gu, "")
                    .replace(/ı/g, "i");

                return Array.from(
                    document.querySelectorAll(selector)
                ).some((element) => {
                    const styles = window.getComputedStyle(element);
                    const rectangle = element.getBoundingClientRect();
                    const isVisible = rectangle.width > 0
                        && rectangle.height > 0
                        && styles.display !== "none"
                        && styles.visibility !== "hidden"
                        && styles.opacity !== "0";
                    const ariaLabel = normalizeText(
                        element.getAttribute("aria-label")
                    );

                    return isVisible && labels.some((label) =>
                        ariaLabel === normalizeText(label)
                    );
                });
            },
            { timeout: 10000 },
            buttonSelector,
            dismissButtonLabels
        );

        await buttonFoundHandle.dispose();

        const handle = await page.evaluateHandle(
            (selector, labels) => {
                const normalizeText = (text) => String(text ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase()
                    .normalize("NFKD")
                    .replace(/\p{M}/gu, "")
                    .replace(/ı/g, "i");

                return Array.from(
                    document.querySelectorAll(selector)
                ).find((element) => {
                    const styles = window.getComputedStyle(element);
                    const rectangle = element.getBoundingClientRect();
                    const isVisible = rectangle.width > 0
                        && rectangle.height > 0
                        && styles.display !== "none"
                        && styles.visibility !== "hidden"
                        && styles.opacity !== "0";
                    const ariaLabel = normalizeText(
                        element.getAttribute("aria-label")
                    );

                    return isVisible && labels.some((label) =>
                        ariaLabel === normalizeText(label)
                    );
                }) ?? null;
            },
            buttonSelector,
            dismissButtonLabels
        );

        buttonHandle = handle.asElement();

        if (!buttonHandle) {
            await handle.dispose();
            throw new Error("Не знайдено кнопку Dismiss");
        }

        const ariaLabel = await buttonHandle.evaluate((element) =>
            element.getAttribute("aria-label")
        );
        console.log(`Знайдено кнопку: ${ariaLabel}`);

        console.log("Наводимо курсор на кнопку Dismiss...");
        await moveMouseToElement(page, buttonHandle, {
            steps: [8, 18],
        });

        console.log("Утримуємо курсор на кнопці 1,5 секунди...");
        await wait(1500);

        console.log("Натискаємо кнопку Dismiss лівою кнопкою миші...");
        await clickLeftMouse(page, {
            holdDelay: [70, 160],
        });

        console.log("Кнопку Dismiss успішно натиснуто");
        return true;
    } catch (error) {
        console.error(
            "Не вдалося натиснути кнопку Dismiss:",
            error.message
        );
        return false;
    } finally {
        await buttonHandle?.dispose().catch(() => {});

        console.log("Очікуємо 3–5 секунд після дії...");
        await waitHuman("long");
    }
}
