import {
    clickUntilConfirmed,
    clickWhenStable,
    describeLocator,
    waitForDomQuiet,
} from "../browser/confirmedClick.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import { humanClickElement as browserHumanClickElement } from "../browser/pointer.js";
import waitForUiReady from "../browser/waitForUiReady.js";
import { waitRandom as waitRandomDelay } from "../browser/timing.js";
import { facebookNameChangeSelectors as selectors } from "../selectors/accountCenter.js";
import { facebookTranslations } from "../i18n/index.js";


const PROFILES_URL = "https://accountscenter.facebook.com/profiles";
const FORCED_ACCOUNT_SWITCH_PART =
    "www.facebook.com/forced_account_switch";

export const facebookNameChangeStatuses = Object.freeze({
    CHANGED: "CHANGED",
    RECENTLY_CHANGED: "RECENTLY_CHANGED",
    UNUSUAL_DEVICE: "UNUSUAL_DEVICE",
    WHATSAPP_REQUIRED: "WHATSAPP_REQUIRED",
    FORCED_ACCOUNT_SWITCH: "FORCED_ACCOUNT_SWITCH",
    UNEXPECTED_PAGE: "UNEXPECTED_PAGE",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
    NAME_BUTTON_FAILED: "NAME_BUTTON_FAILED",
    UNKNOWN_RESULT: "UNKNOWN_RESULT",
    ERROR: "ERROR",
});


class FacebookNameChangeError extends Error {
    constructor(message, {
        code = "FACEBOOK_NAME_CHANGE_FAILED",
        stage = null,
        selector = null,
        timeoutMs = null,
        url = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookNameChangeError";
        this.code = code;
        this.stage = stage;
        this.selector = selector;
        this.timeoutMs = timeoutMs;
        this.url = url;
    }
}


function createErrorDetails(error, fallback = {}) {
    return {
        code: error?.code ?? fallback.code
            ?? "FACEBOOK_NAME_CHANGE_FAILED",
        message: error?.message ?? String(error),
        stage: error?.stage ?? fallback.stage ?? null,
        selector: error?.selector ?? fallback.selector ?? null,
        timeoutMs: error?.timeoutMs ?? fallback.timeoutMs ?? null,
        url: error?.url ?? fallback.url ?? null,
        name: error?.name ?? "Error",
        stack: error?.stack ?? null,
    };
}


function emitLog(logger, level, event, message, fields = {}) {
    const completed = event === "facebook.name_change.completed";
    if (typeof logger?.child !== "function" && !completed) {
        return;
    }
    const method = logger?.[level];

    if (typeof method !== "function") {
        return;
    }

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields, { userVisible: completed });
            return;
        }

        method.call(
            logger,
            message
        );
    } catch {
        // Помилка журналювання не повинна зупиняти Facebook action
    }
}


function normalizeText(value) {
    return String(value ?? "")
        .replace(/[’‘`]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}


function isProfilesUrl(value) {
    try {
        const url = new URL(value);

        return url.hostname === "accountscenter.facebook.com"
            && (
                url.pathname === "/profiles"
                || url.pathname.startsWith("/profiles/")
            );
    } catch {
        return false;
    }
}


function isAccountsCenterLandingUrl(value) {
    try {
        const url = new URL(value);
        const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";

        return url.hostname === "accountscenter.facebook.com"
            && ["/", "/home"].includes(normalizedPath);
    } catch {
        return false;
    }
}


async function waitRandom(minimum, maximum, report, stage, reason) {
    return waitRandomDelay(minimum, maximum, {
        onDelay: (delayMs) => {
            report(stage, `Пауза ${delayMs} мс: ${reason}`, {
                delayMs,
            });
        },
    });
}

async function waitForVisibleSelector(
    page,
    selector,
    timeout,
    report,
    stage
) {
    report(stage, `Чекаємо видимий селектор: ${selector}`, {
        selector,
        timeout,
    });

    let element;

    try {
        element = await waitForVisibleElement(page, selector, {
            timeout,
        });
    } catch (error) {
        throw new FacebookNameChangeError(
            `Не знайдено видимий елемент за селектором: ${selector}`,
            {
                code: "FACEBOOK_NAME_SELECTOR_TIMEOUT",
                stage,
                selector,
                timeoutMs: timeout,
                url: page.url(),
                cause: error,
            }
        );
    } finally {
        await element?.dispose().catch(() => {});
    }

    const count = await page.$$eval(
        selector,
        (elements) => elements.length
    );
    report(stage, `Селектор знайдено, елементів: ${count}`, {
        selector,
        count,
    });
}

async function getVisibleElementBySelector(page, selector) {
    const element = await getFirstVisibleElement(page, selector);

    return element ? { element, handle: element } : null;
}

async function humanClickElement(
    page,
    element,
    report,
    stage,
    description,
    pauseBeforeClick = null,
    selector = null
) {
    const beforeDelay = pauseBeforeClick
        ? [pauseBeforeClick.minimum, pauseBeforeClick.maximum]
        : [100, 260];

    await browserHumanClickElement(page, element, {
        scrollDelay: [900, 1600],
        fallbackScrollDelay: [250, 500],
        beforeDelay,
        holdDelay: [80, 170],
        steps: [9, 19],
        ...createClickOptions(report, stage, description, selector),
    });

    report(stage, `Клікнули ЛКМ по «${description}»`, {
        selector,
    });
}


function createClickOptions(report, stage, description, selector) {
    return {
        onEvent: (event) => {
            if (event.type === "delay") {
                report(
                    stage,
                    `Пауза ${event.delayMs} мс для «${description}»: ${event.reason}`,
                    {
                        delayMs: event.delayMs,
                        reason: event.reason,
                        selector,
                    }
                );
                return;
            }

            if (event.type === "mouse_move") {
                report(stage, `Наводимо курсор на «${description}»`, {
                    x: Math.round(event.x),
                    y: Math.round(event.y),
                    steps: event.steps,
                    box: event.box,
                    selector,
                });
                return;
            }

            report(
                stage,
                `Pointer event для «${description}»: ${event.type}`,
                { ...event, selector }
            );
        },
    };
}


function mapConfirmedClickErrorCode(error) {
    if (error?.code === "BROWSER_CLICK_NOT_CONFIRMED") {
        return "FACEBOOK_NAME_DIALOG_NOT_OPENED";
    }

    if (error?.code === "BROWSER_DOM_NOT_STABLE") {
        return "FACEBOOK_NAME_DOM_NOT_STABLE";
    }

    if (error?.code === "BROWSER_ELEMENT_INTERACTION_FAILED") {
        return "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED";
    }

    return "FACEBOOK_NAME_SELECTOR_TIMEOUT";
}


async function runConfirmedClick(page, options, report, stage) {
    const selector = describeLocator(options.target);

    try {
        return await clickUntilConfirmed(page, {
            ...options,
            clickOptions: createClickOptions(
                report,
                stage,
                options.description,
                selector
            ),
            onStep: (message, details) => report(stage, message, details),
        });
    } catch (error) {
        throw new FacebookNameChangeError(error.message, {
            code: mapConfirmedClickErrorCode(error),
            stage,
            selector: error.selector ?? selector,
            timeoutMs: error.timeoutMs ?? null,
            url: page.url(),
            cause: error,
        });
    }
}


async function runStableClick(page, options, report, stage) {
    const selector = describeLocator(options.target);

    try {
        return await clickWhenStable(page, {
            ...options,
            clickOptions: createClickOptions(
                report,
                stage,
                options.description,
                selector
            ),
            onStep: (message, details) => report(stage, message, details),
        });
    } catch (error) {
        throw new FacebookNameChangeError(error.message, {
            code: mapConfirmedClickErrorCode(error),
            stage,
            selector: error.selector ?? selector,
            timeoutMs: error.timeoutMs ?? null,
            url: page.url(),
            cause: error,
        });
    }
}

async function humanClickSelector(
    page,
    selector,
    report,
    stage,
    description,
    options = {}
) {
    await waitForVisibleSelector(
        page,
        selector,
        options.timeout ?? 30000,
        report,
        stage
    );

    const target = await getVisibleElementBySelector(page, selector);

    if (!target) {
        throw new FacebookNameChangeError(
            `Не знайдено видимий елемент «${description}»`,
            {
                code: "FACEBOOK_NAME_ELEMENT_NOT_FOUND",
                stage,
                selector,
                url: page.url(),
            }
        );
    }

    try {
        try {
            await humanClickElement(
                page,
                target.element,
                report,
                stage,
                description,
                options.pauseBeforeClick,
                selector
            );
        } catch (error) {
            throw new FacebookNameChangeError(
                `Не вдалося клікнути елемент «${description}»: ${error.message}`,
                {
                    code: "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED",
                    stage,
                    selector,
                    url: page.url(),
                    cause: error,
                }
            );
        }
    } finally {
        await target.handle.dispose().catch(() => {});
    }
}


// Функція виконується в браузері й повторно використовується для очікування та пошуку.
export function findNameInputInPage(dialogSelector, labelTexts) {
    const normalize = (text) => String(text ?? "")
        .replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (element) => {
        if (!element?.isConnected || element.closest('[aria-hidden="true"]')) return false;
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return box.width > 0 && box.height > 0
            && style.display !== "none" && style.visibility !== "hidden"
            && style.opacity !== "0";
    };
    const expected = labelTexts.map(normalize);
    for (const dialog of document.querySelectorAll(dialogSelector)) {
        if (!isVisible(dialog)) continue;
        for (const label of dialog.querySelectorAll("label")) {
            if (!expected.includes(normalize(label.textContent))) continue;
            const input = label.control;
            if (input?.tagName === "INPUT" && input.type === "text"
                && dialog.contains(input) && isVisible(input)
                && !input.disabled && !input.readOnly) return input;
        }
    }
    return null;
}


async function getNameInput(page, labelTexts) {
    const handle = await page.evaluateHandle(
        findNameInputInPage, selectors.anyNameDialog, labelTexts
    );
    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return { element, handle };
}


async function humanTypeInput(
    page,
    labelTexts,
    value,
    report,
    stage
) {
    const labelText = labelTexts.join(" / ");
    const selectorDescription =
        `${selectors.anyNameDialog} label[text="${labelText}"] -> control`;
    const timeout = 30000;

    report(stage, `Шукаємо поле за label «${labelText}»`, {
        labelText,
        selector: selectorDescription,
        timeout,
    });

    let labelHandle;

    try {
        labelHandle = await page.waitForFunction(
            findNameInputInPage, { timeout }, selectors.anyNameDialog, labelTexts
        );
    } catch (error) {
        throw new FacebookNameChangeError(
            `Не знайдено поле «${labelText}»`,
            {
                code: "FACEBOOK_NAME_SELECTOR_TIMEOUT",
                stage,
                selector: selectorDescription,
                timeoutMs: timeout,
                url: page.url(),
                cause: error,
            }
        );
    }

    await labelHandle.dispose();

    const stable = await waitForDomQuiet(page, { selector: selectors.anyNameDialog }, {
        quietMs: 300,
        timeout,
    });
    if (!stable) {
        throw new FacebookNameChangeError(`Форма поля «${labelText}» не стабілізувалася`, {
            code: "FACEBOOK_NAME_DOM_NOT_STABLE",
            stage,
            selector: selectorDescription,
            timeoutMs: timeout,
            url: page.url(),
        });
    }

    const target = await getNameInput(page, labelTexts);

    if (!target) {
        throw new FacebookNameChangeError(
            `Не знайдено поле «${labelText}»`,
            {
                code: "FACEBOOK_NAME_ELEMENT_NOT_FOUND",
                stage,
                selector: selectorDescription,
                url: page.url(),
            }
        );
    }

    try {
        await humanClickElement(
            page,
            target.element,
            report,
            stage,
            `поле ${labelText}`,
            null,
            selectorDescription
        );
        await target.element.focus();

        const focused = await target.element.evaluate(
            (input) => document.activeElement === input
        );
        report(stage, `Поле «${labelText}» отримало focus`, {
            focused,
        });

        if (!focused) {
            throw new FacebookNameChangeError(
                `Не вдалося встановити focus у полі «${labelText}»`,
                {
                    code: "FACEBOOK_NAME_INPUT_FOCUS_FAILED",
                    stage,
                    selector: selectorDescription,
                    url: page.url(),
                }
            );
        }

        await page.keyboard.down("Control");
        await page.keyboard.press("A");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");

        report(stage, `Вводимо значення у «${labelText}»`, {
            characters: [...value].length,
        });

        for (const character of value) {
            await page.keyboard.type(character);
            await waitRandom(
                85,
                230,
                report,
                stage,
                `затримка після символу у «${labelText}»`
            );
        }

        const actualValue = await target.element.evaluate(
            (input) => input.value
        );
        report(stage, `Поле «${labelText}» заповнено`, {
            matches: actualValue === value,
            actualValue,
        });

        if (actualValue !== value) {
            throw new FacebookNameChangeError(
                `Поле «${labelText}» містить неочікуване значення`,
                {
                    code: "FACEBOOK_NAME_INPUT_VALUE_MISMATCH",
                    stage,
                    selector: selectorDescription,
                    url: page.url(),
                }
            );
        }
    } catch (error) {
        if (error instanceof FacebookNameChangeError) {
            throw error;
        }

        throw new FacebookNameChangeError(
            `Не вдалося взаємодіяти з полем «${labelText}»: ${error.message}`,
            {
                code: "FACEBOOK_NAME_INPUT_INTERACTION_FAILED",
                stage,
                selector: selectorDescription,
                url: page.url(),
                cause: error,
            }
        );
    } finally {
        await target.handle.dispose().catch(() => {});
    }
}


async function readVisibleDialogs(page) {
    return page.evaluate((dialogSelector) => {
        return Array.from(document.querySelectorAll(dialogSelector))
            .filter((element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            })
            .map((element) => String(element.innerText ?? "")
                .replace(/\s+/g, " ")
                .trim())
            .filter(Boolean);
    }, selectors.visibleDialogs);
}


const blockingRules = [
    { pattern: /last\s+60\s+days/i, status: facebookNameChangeStatuses.RECENTLY_CHANGED },
    { pattern: /can't make this change at the moment|cannot make this change at the moment|device you (?:don't|do not) usually use|used this device for a while/i,
        status: facebookNameChangeStatuses.UNUSUAL_DEVICE },
    { pattern: /check your whatsapp messages|code we sent to your whatsapp/i,
        status: facebookNameChangeStatuses.WHATSAPP_REQUIRED },
];

function classifyBlockingText(text) {
    return blockingRules.find((rule) => rule.pattern.test(normalizeText(text)))?.status ?? null;
}

export function nameChangeOutcomeInPage(config) {
    const normalize = (value) => String(value ?? "").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
    const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    if ([...document.querySelectorAll(config.finalName)].some((node) =>
        visible(node) && normalize(node.textContent) === config.expectedName)) return true;
    const text = [...document.querySelectorAll(config.dialogs)].filter(visible)
        .map((node) => normalize(node.innerText)).join(" ");
    return config.patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}


export default async function changeFacebookName(
    page,
    { firstName, lastName, logger = console, timeout = 90000 } = {}
) {
    const normalizedFirstName = normalizeText(firstName);
    const normalizedLastName = normalizeText(lastName);
    const expectedFullName = normalizeText(
        `${normalizedFirstName} ${normalizedLastName}`
    );
    const startedAt = new Date().toISOString();
    const diagnostics = [];
    let stage = "VALIDATE_INPUT";

    const report = (
        currentStage,
        message,
        details = null,
        {
            level = "debug",
            event = "facebook.name_change.step",
        } = {}
    ) => {
        const logFields = {
            stage: currentStage,
            url: page.url(),
            ...(details ?? {}),
        };
        const entry = {
            at: new Date().toISOString(),
            level,
            event,
            stage: currentStage,
            message,
            details: logFields,
        };

        diagnostics.push(entry);
        emitLog(logger, level, event, message, logFields);
    };
    const finish = (status, extra = {}) => {
        const success = status === facebookNameChangeStatuses.CHANGED;
        const errorStatus = [
            facebookNameChangeStatuses.ERROR,
            facebookNameChangeStatuses.ELEMENT_NOT_FOUND,
            facebookNameChangeStatuses.NAME_BUTTON_FAILED,
            facebookNameChangeStatuses.UNKNOWN_RESULT,
            facebookNameChangeStatuses.UNEXPECTED_PAGE,
        ].includes(status);
        const level = success ? "info" : errorStatus ? "error" : "warn";

        report(
            stage,
            success
                ? "Ім’я та прізвище змінено"
                : `Не вдалося змінити ім’я та прізвище: ${extra.error?.message ?? ({
                    RECENTLY_CHANGED: "ім’я вже змінювали протягом останніх 60 днів",
                    UNUSUAL_DEVICE: "Facebook обмежив зміну з незвичного пристрою",
                    WHATSAPP_REQUIRED: "потрібне підтвердження через WhatsApp",
                }[status] ?? status)}`,
            {
                status,
                success,
                expectedFullName,
                error: extra.error ?? null,
            },
            {
                level,
                event: "facebook.name_change.completed",
            }
        );

        return {
            success,
            status,
            stage,
            expectedFullName,
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: page.url(),
            failedSelector: extra.error?.selector ?? null,
            diagnostics,
            ...extra,
        };
    };

    if (!normalizedFirstName || !normalizedLastName) {
        const error = createErrorDetails(
            new FacebookNameChangeError(
                "Ім’я та прізвище не можуть бути порожніми",
                {
                    code: "FACEBOOK_NAME_INVALID_INPUT",
                    stage,
                    url: page.url(),
                }
            )
        );
        return finish(facebookNameChangeStatuses.ERROR, { error });
    }

    try {
        stage = "OPEN_PROFILES";
        report(stage, `Відкриваємо ${PROFILES_URL}`);
        await page.goto(PROFILES_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        const landingReady = await page.waitForFunction((selector) => {
            if (location.href.includes("www.facebook.com/forced_account_switch")) return true;
            return document.readyState !== "loading" && [...document.querySelectorAll(selector)]
                .some((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
        }, { timeout }, `${selectors.profile}, ${selectors.accountOverview}`);
        await landingReady?.dispose?.().catch(() => {});

        const profilesUrl = page.url();
        report(stage, `URL після переходу: ${profilesUrl}`, {
            url: profilesUrl,
        });

        if (profilesUrl.includes(FORCED_ACCOUNT_SWITCH_PART)) {
            report(
                stage,
                "Facebook вимагає переключити фанпейдж на особистий профіль"
            );
            return finish(
                facebookNameChangeStatuses.FORCED_ACCOUNT_SWITCH,
                {
                    error: createErrorDetails(
                        new FacebookNameChangeError(
                            "Не вдалося переключитися з фанпейджа на особистий профіль",
                            {
                                code: "FACEBOOK_NAME_FORCED_ACCOUNT_SWITCH",
                                stage,
                                url: profilesUrl,
                            }
                        )
                    ),
                }
            );
        }

        const openedProfilesDirectly = isProfilesUrl(profilesUrl);
        const openedAccountsCenterRoot =
            isAccountsCenterLandingUrl(profilesUrl);

        if (!openedProfilesDirectly && !openedAccountsCenterRoot) {
            report(stage, "Не потрапили на сторінку Accounts Center profiles");
            return finish(facebookNameChangeStatuses.UNEXPECTED_PAGE, {
                error: createErrorDetails(
                    new FacebookNameChangeError(
                        "Не вдалося відкрити Accounts Center profiles",
                        {
                            code: "FACEBOOK_NAME_UNEXPECTED_PAGE",
                            stage,
                            url: profilesUrl,
                        }
                    )
                ),
            });
        }

        if (openedAccountsCenterRoot) {
            stage = "OPEN_ACCOUNT_OVERVIEW";
            report(
                stage,
                "Profiles перенаправив на корінь Accounts Center"
            );
            await humanClickSelector(
                page,
                selectors.accountOverview,
                report,
                stage,
                "account_overview"
            );

            stage = "WAIT_ACCOUNT_OVERVIEW_DIALOG";
            await waitForVisibleSelector(
                page,
                selectors.accountOverviewDialog,
                30000,
                report,
                stage
            );
            await waitForUiReady(page, selectors.accountOverviewDialogLink, { timeout });

            stage = "SELECT_ACCOUNT_FROM_OVERVIEW";
            await humanClickSelector(
                page,
                selectors.accountOverviewDialogLink,
                report,
                stage,
                "Facebook-профіль у модальному вікні account_overview"
            );
            await waitForUiReady(page, selectors.nameLink, { timeout });
        } else {
            await waitForUiReady(page, selectors.profile, { timeout });

            stage = "SELECT_PROFILE";
            await humanClickSelector(
                page,
                selectors.profile,
                report,
                stage,
                "особистий Facebook-профіль"
            );

            stage = "WAIT_PROFILE_DIALOG";
            await waitForVisibleSelector(
                page,
                selectors.profileDialog,
                30000,
                report,
                stage
            );
            await waitForUiReady(page, selectors.nameLink, { timeout });
        }

        stage = "OPEN_NAME_DIALOG";
        try {
            await runConfirmedClick(
                page,
                {
                    target: {
                        selector: selectors.nameLink,
                        index: 0,
                    },
                    confirm: {
                        selector: selectors.nameDialog,
                    },
                    description: "Name",
                    attempts: 1,
                    confirmTimeout: 15000,
                    quietMs: 300,
                    quietTimeout: 15000,
                    requireQuiet: true,
                },
                report,
                stage
            );
        } catch (error) {
            const errorDetails = createErrorDetails(error, {
                stage,
                url: page.url(),
            });
            report(
                stage,
                "Не вдалося натиснути кнопку Name, поля імені не з’явились",
                errorDetails,
                {
                    level: "error",
                    event: "facebook.name_change.name_button_failed",
                }
            );
            return finish(facebookNameChangeStatuses.NAME_BUTTON_FAILED, {
                error: {
                    ...errorDetails,
                    message: "Не вдалося натиснути кнопку Name",
                },
            });
        }

        stage = "WAIT_NAME_DIALOG";
        await waitForUiReady(page, selectors.nameDialog, { timeout });

        const initialDialogs = await readVisibleDialogs(page);
        const initialText = initialDialogs.join(" ");
        const initialBlock = classifyBlockingText(initialText);
        report(stage, "Прочитали текст відкритих діалогів", {
            dialogCount: initialDialogs.length,
            text: initialText.slice(0, 1500),
        });

        if (initialBlock) {
            return finish(initialBlock, {
                blockingText: initialText,
            });
        }

        stage = "FILL_NAME";
        await humanTypeInput(
            page,
            facebookTranslations.en.nameChange.firstName,
            normalizedFirstName,
            report,
            stage
        );

        await humanTypeInput(
            page,
            facebookTranslations.en.nameChange.lastName,
            normalizedLastName,
            report,
            stage
        );

        stage = "REVIEW_CHANGE";
        await runConfirmedClick(
            page,
            {
                target: {
                    candidateSelector: "span",
                    expectedText: "Review change",
                    closestSelector: '[role="button"]',
                },
                confirm: {
                    candidateSelector: '[role="button"]',
                    expectedText: "Done",
                },
                description: "Review change",
            },
            report,
            stage
        );

        stage = "SUBMIT_CHANGE";
        await runStableClick(
            page,
            {
                target: {
                    candidateSelector: '[role="button"]',
                    expectedText: "Done",
                },
                description: "Done",
            },
            report,
            stage
        );

        stage = "WAIT_RESULT";
        await waitForVisibleSelector(
            page,
            selectors.anyDialog,
            30000,
            report,
            stage
        );
        const outcomeHandle = await page.waitForFunction(nameChangeOutcomeInPage, { timeout }, {
            finalName: selectors.finalName, expectedName: expectedFullName,
            dialogs: selectors.visibleDialogs, patterns: blockingRules.map((rule) => rule.pattern.source),
        });
        await outcomeHandle?.dispose?.().catch(() => {});
        await waitForUiReady(page, selectors.anyDialog, { timeout });

        const resultDialogs = await readVisibleDialogs(page);
        const resultText = resultDialogs.join(" ");
        const blockingStatus = classifyBlockingText(resultText);
        report(stage, "Прочитали фінальні діалоги", {
            dialogCount: resultDialogs.length,
            text: resultText.slice(0, 2000),
        });

        if (blockingStatus) {
            return finish(blockingStatus, {
                blockingText: resultText,
            });
        }

        const displayedNames = await page.$$eval(
            selectors.finalName,
            (elements) => elements.map((element) =>
                String(element.textContent ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
            ).filter(Boolean)
        );
        const confirmedName = displayedNames.find(
            (name) => normalizeText(name) === expectedFullName
        ) ?? null;

        report(stage, "Перевіряємо фінальне ім’я", {
            selector: selectors.finalName,
            displayedNames,
            expectedFullName,
            confirmedName,
        });

        if (confirmedName) {
            return finish(facebookNameChangeStatuses.CHANGED, {
                confirmedName,
            });
        }

        return finish(facebookNameChangeStatuses.UNKNOWN_RESULT, {
            error: createErrorDetails(
                new FacebookNameChangeError(
                    "Facebook не показав очікуване ім’я після збереження",
                    {
                        code: "FACEBOOK_NAME_CONFIRMATION_NOT_FOUND",
                        stage,
                        selector: selectors.finalName,
                        url: page.url(),
                    }
                )
            ),
            displayedNames,
            dialogText: resultText,
        });
    } catch (error) {
        const errorDetails = createErrorDetails(error, {
            stage,
            url: page.url(),
        });
        stage = errorDetails.stage;
        const isSelectorError = [
            "FACEBOOK_NAME_SELECTOR_TIMEOUT",
            "FACEBOOK_NAME_ELEMENT_NOT_FOUND",
            "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED",
        ].includes(errorDetails.code)
            || /не знайдено|selector/i.test(errorDetails.message);
        const status = isSelectorError
            ? facebookNameChangeStatuses.ELEMENT_NOT_FOUND
            : facebookNameChangeStatuses.ERROR;

        report(
            stage,
            `Помилка: ${errorDetails.message}`,
            errorDetails,
            {
                level: "error",
                event: "facebook.name_change.failed",
            }
        );

        return finish(status, {
            error: errorDetails,
            dialogText: (await readVisibleDialogs(page).catch(() => []))
                .join(" "),
        });
    }
}


export { selectors as facebookNameChangeSelectors };
