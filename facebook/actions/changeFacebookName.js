const PROFILES_URL = "https://accountscenter.facebook.com/profiles";
const FORCED_ACCOUNT_SWITCH_PART =
    "www.facebook.com/forced_account_switch";

const selectors = {
    accountOverview:
        'a[href*="account_overview"]',
    accountOverviewDialog:
        'div[role="dialog"][aria-modal="true"]',
    accountOverviewDialogLink:
        'div[role="dialog"][aria-modal="true"] '
        + 'a[role="link"][href*="entrypoint=account_overview"]',
    profile:
        'div[role="list"] [role="listitem"] [aria-label] '
        + '[aria-hidden="true"][role="presentation"]',
    profileDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby] '
        + '[aria-hidden="false"]',
    nameLink: 'a[role="link"][aria-label="Name"]',
    nameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"] '
        + '[aria-hidden="false"]',
    anyNameDialog:
        'div[aria-label="Name"][aria-modal="true"][role="dialog"]',
    anyDialog:
        'div[role="dialog"][aria-modal="true"][aria-labelledby]',
    visibleDialogs:
        'div[role="dialog"][aria-modal="true"]',
    finalName: 'h3[dir="auto"] > span',
};

export const facebookNameChangeStatuses = Object.freeze({
    CHANGED: "CHANGED",
    RECENTLY_CHANGED: "RECENTLY_CHANGED",
    UNUSUAL_DEVICE: "UNUSUAL_DEVICE",
    WHATSAPP_REQUIRED: "WHATSAPP_REQUIRED",
    FORCED_ACCOUNT_SWITCH: "FORCED_ACCOUNT_SWITCH",
    UNEXPECTED_PAGE: "UNEXPECTED_PAGE",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
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
    const method = logger?.[level];

    if (typeof method !== "function") {
        return;
    }

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields);
            return;
        }

        method.call(
            logger,
            `[changeFacebookName] [${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка журналювання не повинна зупиняти Facebook action
    }
}


function randomInteger(minimum, maximum) {
    return Math.floor(
        Math.random() * (maximum - minimum + 1)
    ) + minimum;
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
    const delayMs = randomInteger(minimum, maximum);

    report(stage, `Пауза ${delayMs} мс: ${reason}`, { delayMs });
    await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
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

    let readyHandle;

    try {
        readyHandle = await page.waitForFunction((targetSelector) => {
            return Array.from(document.querySelectorAll(targetSelector))
                .some((element) => {
                    const rectangle = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);

                    return rectangle.width > 0
                        && rectangle.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0";
                });
        }, { timeout }, selector);
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
    }

    await readyHandle.dispose();

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
    const handle = await page.evaluateHandle((targetSelector) => {
        return Array.from(document.querySelectorAll(targetSelector))
            .find((element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            }) ?? null;
    }, selector);
    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return { element, handle };
}


async function humanClickElement(
    page,
    element,
    report,
    stage,
    description,
    pauseBeforeClick = null
) {
    await element.evaluate((target) => {
        target.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
        });
    });

    await waitRandom(
        900,
        1600,
        report,
        stage,
        `прокрутка до елемента «${description}»`
    );

    let box = await element.boundingBox();

    const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
    const hasUsableViewport = viewport.width >= 100
        && viewport.height >= 100;
    const outsideViewport = box
        && (
            box.x < 0
            || box.y < 0
            || (
                hasUsableViewport
                && (
                    box.x + box.width > viewport.width
                    || box.y + box.height > viewport.height
                )
            )
        );

    if (outsideViewport) {
        report(
            stage,
            `Елемент «${description}» ще поза viewport, центруємо повторно`,
            { box, viewport }
        );
        await element.evaluate((target) => {
            target.scrollIntoView({
                behavior: "auto",
                block: "center",
                inline: "center",
            });
        });
        await waitRandom(
            250,
            500,
            report,
            stage,
            `стабілізація позиції «${description}»`
        );
        box = await element.boundingBox();
    }

    if (!box) {
        throw new Error(
            `Не вдалося визначити координати елемента «${description}»`
        );
    }

    if (
        box.x < 0
        || box.y < 0
        || (
            hasUsableViewport
            && (
                box.x + box.width > viewport.width
                || box.y + box.height > viewport.height
            )
        )
    ) {
        throw new Error(
            `Елемент «${description}» залишився поза viewport після прокрутки`
        );
    }

    const x = box.x + box.width * (0.25 + Math.random() * 0.5);
    const y = box.y + box.height * (0.25 + Math.random() * 0.5);
    const steps = randomInteger(9, 19);

    report(stage, `Наводимо курсор на «${description}»`, {
        x: Math.round(x),
        y: Math.round(y),
        steps,
    });
    await page.mouse.move(x, y, { steps });

    if (pauseBeforeClick) {
        await waitRandom(
            pauseBeforeClick.minimum,
            pauseBeforeClick.maximum,
            report,
            stage,
            `перед кліком по «${description}»`
        );
    } else {
        await waitRandom(
            100,
            260,
            report,
            stage,
            `перед кліком по «${description}»`
        );
    }

    await page.mouse.down({ button: "left" });
    await waitRandom(
        80,
        170,
        report,
        stage,
        `утримання ЛКМ на «${description}»`
    );
    await page.mouse.up({ button: "left" });
    report(stage, `Клікнули ЛКМ по «${description}»`);
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
                options.pauseBeforeClick
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


async function humanClickFirstSelector(
    page,
    selector,
    report,
    stage,
    description,
    options = {}
) {
    report(stage, `Чекаємо перший видимий елемент: ${selector}`, {
        selector,
        timeout: options.timeout ?? 30000,
        index: 0,
    });

    const timeout = options.timeout ?? 30000;
    let readyHandle;

    try {
        readyHandle = await page.waitForFunction((targetSelector) => {
            const element = document.querySelectorAll(targetSelector)[0];

            if (!element) {
                return false;
            }

            const rectangle = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        }, { timeout }, selector);
    } catch (error) {
        throw new FacebookNameChangeError(
            `Не знайдено перший видимий елемент «${description}»`,
            {
                code: "FACEBOOK_NAME_SELECTOR_TIMEOUT",
                stage,
                selector: `${selector}[0]`,
                timeoutMs: timeout,
                url: page.url(),
                cause: error,
            }
        );
    }

    await readyHandle.dispose();

    const element = await page.$(selector);

    if (!element) {
        throw new FacebookNameChangeError(
            `Не знайдено перший елемент «${description}»`,
            {
                code: "FACEBOOK_NAME_ELEMENT_NOT_FOUND",
                stage,
                selector: `${selector}[0]`,
                url: page.url(),
            }
        );
    }

    report(stage, `Знайдено ${selector}[0]`, {
        selector,
        index: 0,
    });

    try {
        try {
            await humanClickElement(
                page,
                element,
                report,
                stage,
                description,
                options.pauseBeforeClick
            );
        } catch (error) {
            throw new FacebookNameChangeError(
                `Не вдалося клікнути перший елемент «${description}»: ${error.message}`,
                {
                    code: "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED",
                    stage,
                    selector: `${selector}[0]`,
                    url: page.url(),
                    cause: error,
                }
            );
        }
    } finally {
        await element.dispose().catch(() => {});
    }
}


async function getVisibleElementByText(
    page,
    candidateSelector,
    expectedText,
    closestSelector = null
) {
    const handle = await page.evaluateHandle(
        (selector, text, closest) => {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const candidate = Array.from(
                document.querySelectorAll(selector)
            ).find((element) => normalize(element.textContent) === text);
            const target = closest
                ? candidate?.closest(closest)
                : candidate;

            if (!target) {
                return null;
            }

            const rectangle = target.getBoundingClientRect();
            const style = window.getComputedStyle(target);
            const visible = rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";

            return visible ? target : null;
        },
        candidateSelector,
        expectedText,
        closestSelector
    );
    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return { element, handle };
}


async function waitForTextButton(
    page,
    candidateSelector,
    expectedText,
    closestSelector,
    report,
    stage
) {
    const selectorDescription = closestSelector
        ? `${candidateSelector} text="${expectedText}" -> closest(${closestSelector})`
        : `${candidateSelector} text="${expectedText}"`;
    const timeout = 30000;

    report(stage, `Шукаємо кнопку з текстом «${expectedText}»`, {
        candidateSelector,
        closestSelector,
        selector: selectorDescription,
        timeout,
    });

    let readyHandle;

    try {
        readyHandle = await page.waitForFunction(
            (selector, text, closest) => {
                const normalize = (value) => String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim();

                return Array.from(document.querySelectorAll(selector))
                    .some((candidate) => {
                        if (normalize(candidate.textContent) !== text) {
                            return false;
                        }

                        const element = closest
                            ? candidate.closest(closest)
                            : candidate;

                        if (!element) {
                            return false;
                        }

                        const rectangle = element.getBoundingClientRect();
                        const style = window.getComputedStyle(element);

                        return rectangle.width > 0
                            && rectangle.height > 0
                            && style.display !== "none"
                            && style.visibility !== "hidden"
                            && style.opacity !== "0";
                    });
            },
            { timeout },
            candidateSelector,
            expectedText,
            closestSelector
        );
    } catch (error) {
        throw new FacebookNameChangeError(
            `Не знайдено кнопку «${expectedText}»`,
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

    await readyHandle.dispose();

    const target = await getVisibleElementByText(
        page,
        candidateSelector,
        expectedText,
        closestSelector
    );

    if (!target) {
        throw new FacebookNameChangeError(
            `Не знайдено кнопку «${expectedText}»`,
            {
                code: "FACEBOOK_NAME_ELEMENT_NOT_FOUND",
                stage,
                selector: selectorDescription,
                url: page.url(),
            }
        );
    }

    report(stage, `Кнопку «${expectedText}» знайдено`);
    return target;
}


async function getNameInput(page, labelText) {
    const handle = await page.evaluateHandle((text) => {
        const label = Array.from(document.querySelectorAll("label"))
            .find((element) => element.textContent?.trim() === text);

        return label?.htmlFor
            ? document.getElementById(label.htmlFor)
            : null;
    }, labelText);
    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return { element, handle };
}


async function humanTypeInput(
    page,
    labelText,
    value,
    report,
    stage
) {
    const selectorDescription =
        `label[textContent="${labelText}"] -> #htmlFor`;
    const timeout = 30000;

    report(stage, `Шукаємо поле за label «${labelText}»`, {
        labelText,
        selector: selectorDescription,
        timeout,
    });

    let labelHandle;

    try {
        labelHandle = await page.waitForFunction((text) => {
            const label = Array.from(document.querySelectorAll("label"))
                .find((element) => element.textContent?.trim() === text);
            const input = label?.htmlFor
                ? document.getElementById(label.htmlFor)
                : null;

            return Boolean(input);
        }, { timeout }, labelText);
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

    const target = await getNameInput(page, labelText);

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
            `поле ${labelText}`
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


function classifyBlockingText(text) {
    const normalized = normalizeText(text);

    if (/last\s+60\s+days/i.test(normalized)) {
        return facebookNameChangeStatuses.RECENTLY_CHANGED;
    }

    if (
        /can't make this change at the moment/i.test(normalized)
        || /cannot make this change at the moment/i.test(normalized)
        || /device you (?:don't|do not) usually use/i.test(normalized)
        || /used this device for a while/i.test(normalized)
    ) {
        return facebookNameChangeStatuses.UNUSUAL_DEVICE;
    }

    if (
        /check your whatsapp messages/i.test(normalized)
        || /code we sent to your whatsapp/i.test(normalized)
    ) {
        return facebookNameChangeStatuses.WHATSAPP_REQUIRED;
    }

    return null;
}


export default async function changeFacebookName(
    page,
    { firstName, lastName, logger = console } = {}
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
            level = "info",
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
            facebookNameChangeStatuses.UNKNOWN_RESULT,
            facebookNameChangeStatuses.UNEXPECTED_PAGE,
        ].includes(status);
        const level = success ? "info" : errorStatus ? "error" : "warn";

        report(
            stage,
            `Зміна імені завершена зі статусом ${status}`,
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
        await waitRandom(
            1500,
            3000,
            report,
            stage,
            "очікування можливого перенаправлення"
        );

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
            await waitRandom(
                3000,
                5000,
                report,
                stage,
                "повне завантаження модального вікна account_overview"
            );

            stage = "SELECT_ACCOUNT_FROM_OVERVIEW";
            await humanClickSelector(
                page,
                selectors.accountOverviewDialogLink,
                report,
                stage,
                "Facebook-профіль у модальному вікні account_overview"
            );
            await waitRandom(
                1500,
                3000,
                report,
                stage,
                "завантаження налаштувань вибраного профілю"
            );
        } else {
            await waitRandom(
                3000,
                5000,
                report,
                stage,
                "повне завантаження списку профілів"
            );

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
            await waitRandom(
                1500,
                3000,
                report,
                stage,
                "завантаження скриптів діалогу профілю"
            );
        }

        stage = "OPEN_NAME_DIALOG";
        await humanClickFirstSelector(
            page,
            selectors.nameLink,
            report,
            stage,
            "Name"
        );

        stage = "WAIT_NAME_DIALOG";
        try {
            await waitForVisibleSelector(
                page,
                selectors.nameDialog,
                8000,
                report,
                stage
            );
        } catch (error) {
            if (error?.code !== "FACEBOOK_NAME_SELECTOR_TIMEOUT") {
                throw error;
            }

            report(
                stage,
                "Перший клік по Name не відкрив форму, повторюємо клік"
            );
            await humanClickFirstSelector(
                page,
                selectors.nameLink,
                report,
                stage,
                "Name, повторний клік"
            );
            await waitForVisibleSelector(
                page,
                selectors.nameDialog,
                30000,
                report,
                stage
            );
        }
        await waitRandom(
            1500,
            3000,
            report,
            stage,
            "завантаження форми імені"
        );

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
            "First name",
            normalizedFirstName,
            report,
            stage
        );
        await waitRandom(
            450,
            900,
            report,
            stage,
            "перехід між полями"
        );
        await humanTypeInput(
            page,
            "Last name",
            normalizedLastName,
            report,
            stage
        );

        stage = "REVIEW_CHANGE";
        const reviewButton = await waitForTextButton(
            page,
            "span",
            "Review change",
            '[role="button"]',
            report,
            stage
        );

        try {
            try {
                await humanClickElement(
                    page,
                    reviewButton.element,
                    report,
                    stage,
                    "Review change"
                );
            } catch (error) {
                throw new FacebookNameChangeError(
                    `Не вдалося клікнути Review change: ${error.message}`,
                    {
                        code: "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED",
                        stage,
                        selector:
                            'span text="Review change" -> closest([role="button"])',
                        url: page.url(),
                        cause: error,
                    }
                );
            }
        } finally {
            await reviewButton.handle.dispose().catch(() => {});
        }

        stage = "WAIT_PREVIEW";
        await waitForVisibleSelector(
            page,
            selectors.anyNameDialog,
            30000,
            report,
            stage
        );
        const doneButton = await waitForTextButton(
            page,
            '[role="button"]',
            "Done",
            null,
            report,
            stage
        );
        await waitRandom(
            1500,
            3000,
            report,
            stage,
            "завантаження прев’ю нового імені"
        );

        stage = "SUBMIT_CHANGE";
        try {
            try {
                await humanClickElement(
                    page,
                    doneButton.element,
                    report,
                    stage,
                    "Done",
                    { minimum: 1500, maximum: 3000 }
                );
            } catch (error) {
                throw new FacebookNameChangeError(
                    `Не вдалося клікнути Done: ${error.message}`,
                    {
                        code: "FACEBOOK_NAME_ELEMENT_INTERACTION_FAILED",
                        stage,
                        selector: '[role="button"] text="Done"',
                        url: page.url(),
                        cause: error,
                    }
                );
            }
        } finally {
            await doneButton.handle.dispose().catch(() => {});
        }

        stage = "WAIT_RESULT";
        await waitForVisibleSelector(
            page,
            selectors.anyDialog,
            30000,
            report,
            stage
        );
        await waitRandom(
            7000,
            10000,
            report,
            stage,
            "остаточне завантаження результату"
        );

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
