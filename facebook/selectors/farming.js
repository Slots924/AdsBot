import { getFacebookTexts } from "../i18n/index.js";

export const farmPostSelector = '[role="feed"] [role="article"], [role="main"] [aria-posinset]';
export const farmButtonSelector = '[role="button"], button';
export const farmTexts = () => Object.fromEntries(["like", "liked", "join", "joined", "pending", "unavailable"].map((key) => [key, getFacebookTexts(`farming.${key}`)]));

// Функція самодостатня для page.evaluate та DOM mock-тестів.
export function findFarmButton(root, labels) {
    if (typeof root === "string") root = document.querySelector(root);
    if (!root) return null;
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const names = labels.map(normalize);
    return [...root.querySelectorAll('[role="button"], button')].find((element) => {
        const rect = element.getBoundingClientRect();
        // У відкритому пості не плутаємо його реакцію з реакціями вкладених коментарів.
        const article = element.closest('[role="article"]');
        if (root.matches('[data-farm-post]') && article && root.contains(article) && article !== root
            && !article.querySelector('[data-ad-rendering-role="story_message"]')) return false;
        return rect.width > 0 && rect.height > 0 && element.getAttribute("aria-disabled") !== "true"
            && !element.disabled && [element.getAttribute("aria-label"), element.textContent].some((text) => names.includes(normalize(text)));
    }) ?? null;
}
