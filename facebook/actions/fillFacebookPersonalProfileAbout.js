import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { wait, waitHuman, waitRandom } from "../browser/timing.js";
import { personalProfileAboutSelectors as aboutSelectors } from "../selectors/personalProfileAbout.js";


export const facebookPersonalProfileAboutStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    PARTIAL: "PARTIAL",
    INVALID_INPUT: "INVALID_INPUT",
    ERROR: "ERROR",
});

export const facebookPersonalProfileAboutFieldStatuses = Object.freeze({
    UPDATED: "UPDATED",
    CLEARED: "CLEARED",
    FILLED: "FILLED",
    SKIPPED: "SKIPPED",
    FAILED: "FAILED",
});

export const facebookPersonalProfileAboutSkipReasons = Object.freeze({
    MISSING_INPUT: "MISSING_INPUT",
    INCOMPLETE_WORK: "INCOMPLETE_WORK",
    ALREADY_EXISTS: "ALREADY_EXISTS",
});


class FacebookPersonalProfileAboutError extends Error {
    constructor(message, {
        code = "FACEBOOK_PERSONAL_ABOUT_FAILED",
        stage = null,
        selector = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookPersonalProfileAboutError";
        this.code = code;
        this.stage = stage;
        this.selector = selector;
    }
}


function emitLog(logger, level, event, message, fields = {}) {
    const method = logger?.[level];
    if (typeof method !== "function") return;

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields);
            return;
        }
        method.call(
            logger,
            `[fillFacebookPersonalProfileAbout] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


async function emitProgress(onProgress, event) {
    if (typeof onProgress !== "function") return;

    try {
        await onProgress(event);
    } catch {
        // Зовнішній progress callback не повинен зупиняти Facebook action.
    }
}


function trimField(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text === "" ? null : text;
}


function halfText(value) {
    const text = String(value ?? "");
    return text.slice(0, Math.floor(text.length / 2));
}


export function normalizeFacebookPersonalProfileAboutFields(fields) {
    if (fields == null || typeof fields !== "object" || Array.isArray(fields)) {
        return null;
    }

    const bio = trimField(fields.bio);
    let work = null;
    let workRequested = false;
    let workSkipReason =
        facebookPersonalProfileAboutSkipReasons.MISSING_INPUT;

    if (Object.prototype.hasOwnProperty.call(fields, "work")) {
        const workInput = fields.work;
        if (
            workInput
            && typeof workInput === "object"
            && !Array.isArray(workInput)
        ) {
            const company = trimField(workInput.company);
            const position = trimField(workInput.position);
            if (company && position) {
                work = { company, position };
                workRequested = true;
                workSkipReason = null;
            } else {
                workSkipReason =
                    facebookPersonalProfileAboutSkipReasons.INCOMPLETE_WORK;
            }
        } else if (workInput != null) {
            workSkipReason =
                facebookPersonalProfileAboutSkipReasons.INCOMPLETE_WORK;
        }
    }

    const education = trimField(fields.education);
    const educationRequested = Boolean(education);

    return {
        bio,
        bioRequested: true,
        work,
        workRequested,
        workSkipReason: workRequested ? null : workSkipReason,
        education,
        educationRequested,
        educationSkipReason: educationRequested
            ? null
            : facebookPersonalProfileAboutSkipReasons.MISSING_INPUT,
    };
}


function createFieldState({
    status = null,
    requested = false,
    skipReason = null,
    error = null,
} = {}) {
    return { status, requested, skipReason, error };
}


function aboutDomRuntime(query) {
    const selectors = query?.selectors ?? {};
    const normalize = (value) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const normalizeLoose = (value) => normalize(value).toLocaleLowerCase();
    const visible = (node) => {
        if (!node) return false;
        const rectangle = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rectangle.width > 0
            && rectangle.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    };
    const findSection = (title) => {
        const expected = normalizeLoose(title);
        return Array.from(document.querySelectorAll("section")).find((section) =>
            Array.from(section.querySelectorAll("h2")).some((heading) =>
                normalizeLoose(heading.innerText) === expected
            )
        ) ?? null;
    };
    const findVisible = (root, selector) => {
        if (!root || !selector) return null;
        return Array.from(root.querySelectorAll(selector)).find(visible) ?? null;
    };
    const findButtonByText = (
        root,
        text,
        buttonSelector = '[role="button"]'
    ) => {
        const expected = normalizeLoose(text);
        return Array.from(root?.querySelectorAll(buttonSelector) ?? [])
            .find((element) =>
                visible(element)
                && normalizeLoose(element.innerText) === expected
            ) ?? null;
    };
    const sectionSnapshot = (title) => {
        const section = findSection(title);
        if (!section) return { found: false };
        const save = findVisible(section, selectors.save);
        const textarea = findVisible(section, "textarea");
        return {
            found: true,
            text: normalize(section.innerText),
            hasEditBio: Boolean(findVisible(section, selectors.editBio)),
            hasAboutYou: Boolean(findButtonByText(section, "About you")),
            hasEditWorkplace: Boolean(
                findVisible(section, selectors.editWorkplace)
            ),
            hasWorkExperience: Boolean(findButtonByText(
                section,
                "Work experience",
                '[role="button"][tabindex="0"]'
            )),
            hasEditCollege: Boolean(findVisible(section, selectors.editCollege)),
            hasTextarea: Boolean(textarea),
            hasSave: Boolean(save),
            saveActive: Boolean(
                save && save.getAttribute("aria-disabled") !== "true"
            ),
            hasCompany: Boolean(findVisible(section, selectors.company)),
            hasPosition: Boolean(findVisible(section, selectors.position)),
            hasCollegeName: Boolean(findVisible(section, selectors.collegeName)),
        };
    };
    const findLeaveDialog = () => findVisible(
        document,
        selectors.leavePageDialog
    );
    const findInvalidNameDialog = () => Array.from(
        document.querySelectorAll(
            selectors.invalidNameDialog || selectors.modalDialog
        )
    ).find((dialog) => {
        if (!visible(dialog)) return false;
        const title = normalizeLoose(
            dialog.querySelector("h2 span[dir='auto']")?.textContent
            ?? dialog.querySelector("h2")?.innerText
        );
        const body = normalizeLoose(dialog.innerText);
        return title === "invalid name"
            || body.includes(
                "creating content with this name is not allowed"
            );
    }) ?? null;
    const readCombobox = (inputSelector) => {
        const input = findVisible(document, inputSelector);
        if (!input) {
            return { found: false, expanded: false, options: [] };
        }
        const listboxId = input.getAttribute("aria-controls");
        const listbox = listboxId
            ? document.getElementById(listboxId)
            : null;
        const options = listbox
            ? Array.from(listbox.querySelectorAll(selectors.comboboxOption))
                .filter(visible)
                .map((option) => normalize(option.innerText))
            : [];
        return {
            found: true,
            expanded: input.getAttribute("aria-expanded") === "true",
            options,
        };
    };

    if (query.mode === "inspect") {
        if (query.kind === "aboutPanel") {
            const panel = findVisible(document, selectors.aboutPanel);
            return Boolean(panel);
        }
        if (query.kind === "sectionSnapshot") {
            const snap = sectionSnapshot(query.title);
            if (query.expectEditor) {
                return snap.found && (
                    snap.hasTextarea
                    || snap.hasCompany
                    || snap.hasCollegeName
                ) ? snap : false;
            }
            if (query.expectFound !== false) {
                return snap.found ? snap : false;
            }
            return snap;
        }
        if (query.kind === "leavePageDialog") {
            const dialog = findLeaveDialog();
            const found = Boolean(dialog);
            if (query.expectAbsent) return !found;
            return {
                found,
                unsaved: Boolean(
                    dialog
                    && normalizeLoose(dialog.innerText).includes(
                        "you have unsaved changes to your profile."
                    )
                ),
            };
        }
        if (query.kind === "invalidNameDialog") {
            const dialog = findInvalidNameDialog();
            if (query.expectAbsent) return !dialog;
            return { found: Boolean(dialog) };
        }
        if (query.kind === "comboboxOptions") {
            const result = readCombobox(query.inputSelector);
            if (query.expectReady) {
                return result.found
                    && result.expanded
                    && result.options.length > 0;
            }
            return result;
        }
        if (query.kind === "inputValue") {
            const input = findVisible(document, query.inputSelector);
            return input ? String(input.value ?? "") : "";
        }
        if (query.kind === "bioOutcome") {
            const snap = sectionSnapshot("Bio");
            if (!snap.found) return false;
            return !snap.hasTextarea && !snap.hasSave;
        }
        if (query.kind === "workOutcome") {
            const snap = sectionSnapshot("Work");
            if (!snap.found) return false;
            return !snap.hasCompany && !snap.hasPosition && !snap.hasSave;
        }
        if (query.kind === "workSaveOutcome") {
            if (findInvalidNameDialog()) {
                return { invalidName: true, saved: false };
            }
            const snap = sectionSnapshot("Work");
            if (!snap.found) return false;
            const editorClosed = !snap.hasCompany
                && !snap.hasPosition
                && !snap.hasSave;
            return editorClosed
                ? { invalidName: false, saved: true }
                : false;
        }
        if (query.kind === "collegeSaveOutcome") {
            if (findInvalidNameDialog()) {
                return { invalidName: true, saved: false };
            }
            const snap = sectionSnapshot("College");
            if (!snap.found) return false;
            const editorClosed = !snap.hasCollegeName && !snap.hasSave;
            return editorClosed
                ? { invalidName: false, saved: true }
                : false;
        }
        if (query.kind === "workTabReady") {
            const snap = sectionSnapshot("Work");
            return Boolean(
                snap.found
                && (
                    snap.hasEditWorkplace
                    || snap.hasWorkExperience
                    || snap.hasCompany
                )
            );
        }
        if (query.kind === "sectionHeadings") {
            return Array.from(document.querySelectorAll("section h2"))
                .map((heading) => normalize(heading.innerText))
                .filter(Boolean);
        }
        if (query.kind === "formOpen") {
            const titles = ["Bio", "Work", "College"];
            return titles.some((title) => {
                const snap = sectionSnapshot(title);
                return snap.found && (
                    snap.hasTextarea
                    || snap.hasCompany
                    || snap.hasCollegeName
                    || snap.hasSave
                );
            });
        }
        return null;
    }

    if (query.kind === "selector") {
        return findVisible(document, query.selector);
    }
    if (query.kind === "sectionButtonByText") {
        const section = findSection(query.title);
        return findButtonByText(
            section,
            query.text,
            query.buttonSelector
        );
    }
    if (query.kind === "sectionButtonByAria") {
        const section = findSection(query.title);
        return findVisible(section, query.selector);
    }
    if (query.kind === "sectionField") {
        const section = findSection(query.title);
        if (!section) return null;
        if (query.field === "bio") {
            const label = Array.from(section.querySelectorAll("label")).find(
                (item) => normalizeLoose(item.innerText)
                    .includes("introduce yourself")
            );
            return label?.querySelector("textarea")
                ?? findVisible(section, "textarea");
        }
        if (query.field === "company") {
            return findVisible(section, selectors.company);
        }
        if (query.field === "position") {
            return findVisible(section, selectors.position);
        }
        if (query.field === "college") {
            return findVisible(section, selectors.collegeName);
        }
        if (query.field === "save") {
            const save = findVisible(section, selectors.save);
            if (!save || save.getAttribute("aria-disabled") === "true") {
                return null;
            }
            return save;
        }
        return null;
    }
    if (query.kind === "comboboxOption") {
        const input = findVisible(document, query.inputSelector);
        const listboxId = input?.getAttribute("aria-controls");
        const listbox = listboxId
            ? document.getElementById(listboxId)
            : null;
        const options = Array.from(
            listbox?.querySelectorAll(selectors.comboboxOption) ?? []
        ).filter(visible);
        if (query.index != null) {
            return options[query.index] ?? null;
        }
        return options[0] ?? null;
    }
    if (query.kind === "leavePageButton") {
        const dialog = findLeaveDialog();
        return findVisible(dialog, selectors.leavePageButton);
    }
    if (query.kind === "invalidNameClose") {
        const dialog = findInvalidNameDialog();
        return findVisible(dialog, selectors.invalidNameOk)
            ?? findVisible(dialog, selectors.dialogOk)
            ?? findVisible(dialog, selectors.dialogClose);
    }
    return null;
}


function isAddOptionText(text) {
    return /^(add\s+["“«])/i.test(String(text ?? "").trim());
}


function sectionIncludes(snapshot, value) {
    if (!snapshot?.found || !value) return false;
    return String(snapshot.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase()
        .includes(String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase());
}


export default async function fillFacebookPersonalProfileAbout(
    page,
    {
        fields,
        timeout = 90000,
        random = Math.random,
        sleep,
        logger = console,
        onProgress = null,
    } = {}
) {
    const startedAt = new Date().toISOString();
    const normalized = normalizeFacebookPersonalProfileAboutFields(fields);
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };
    const fieldStates = {
        bio: createFieldState({ requested: true }),
        work: createFieldState({
            requested: Boolean(normalized?.workRequested),
            skipReason: normalized?.workSkipReason ?? null,
        }),
        education: createFieldState({
            requested: Boolean(normalized?.educationRequested),
            skipReason: normalized?.educationSkipReason ?? null,
        }),
    };
    let stage = "VALIDATE_INPUT";
    let status = facebookPersonalProfileAboutStatuses.ERROR;
    let errorDetails = null;
    let previousField = null;

    const report = (event, message, extra = {}, level = "info") => emitLog(
        logger,
        level,
        event,
        message,
        {
            stage,
            currentUrl: typeof page?.url === "function" ? page.url() : null,
            ...extra,
        }
    );

    const inspect = (query) => page.evaluate(aboutDomRuntime, {
        mode: "inspect",
        selectors: aboutSelectors,
        ...query,
    });

    const waitInspect = async (query, label, waitTimeout = timeout) => {
        report("facebook.personal_about.wait", `Чекаємо: ${label}`, {
            kind: query.kind,
            title: query.title ?? null,
            timeout: waitTimeout,
        });
        const handle = await page.waitForFunction(
            aboutDomRuntime,
            { timeout: waitTimeout },
            {
                mode: "inspect",
                selectors: aboutSelectors,
                ...query,
            }
        );
        await handle?.dispose?.().catch(() => {});
    };

    const waitInspectValue = async (query, label, waitTimeout = timeout) => {
        report("facebook.personal_about.wait", `Чекаємо: ${label}`, {
            kind: query.kind,
            title: query.title ?? null,
            timeout: waitTimeout,
        });
        const handle = await page.waitForFunction(
            aboutDomRuntime,
            { timeout: waitTimeout },
            {
                mode: "inspect",
                selectors: aboutSelectors,
                ...query,
            }
        );
        try {
            if (typeof handle?.jsonValue === "function") {
                return await handle.jsonValue();
            }
            return await inspect(query);
        } finally {
            await handle?.dispose?.().catch(() => {});
        }
    };

    const findHandle = async (query, label) => {
        report("facebook.personal_about.selector.search", `Шукаємо «${label}»`, {
            kind: query.kind,
            title: query.title ?? null,
            selector: query.selector ?? query.inputSelector ?? null,
            text: query.text ?? null,
            field: query.field ?? null,
        });
        const handle = await page.evaluateHandle(aboutDomRuntime, {
            mode: "find",
            selectors: aboutSelectors,
            ...query,
        });
        const element = handle.asElement();
        if (!element) {
            await handle.dispose().catch(() => {});
            report(
                "facebook.personal_about.selector.missing",
                `Не знайдено «${label}»`,
                {
                    kind: query.kind,
                    found: false,
                    count: 0,
                },
                "warn"
            );
            return null;
        }
        report("facebook.personal_about.selector.found", `Знайдено «${label}»`, {
            kind: query.kind,
            found: true,
            count: 1,
        });
        return handle;
    };

    const clickHandle = async (handle, description) => {
        try {
            await humanClickElement(page, handle, {
                scrollDelay: [900, 1600],
                fallbackScrollDelay: [250, 500],
                beforeDelay: [100, 260],
                holdDelay: [80, 170],
                steps: [9, 19],
                ...timingOptions,
            });
            report("facebook.personal_about.click", `Клікнули «${description}»`);
        } finally {
            await handle.dispose().catch(() => {});
        }
    };

    const clickFreshSelector = async (selector, description) => {
        report("facebook.personal_about.selector.search", `Шукаємо «${description}»`, {
            selector,
        });
        const initial = await waitForVisibleElement(page, selector, { timeout });
        await initial.dispose().catch(() => {});
        await waitHuman("short", timingOptions);
        const fresh = await waitForVisibleElement(page, selector, { timeout });
        report("facebook.personal_about.selector.found", `Знайдено «${description}»`, {
            selector,
            found: true,
            count: 1,
        });
        await clickHandle(fresh, description);
    };

    const clickFreshQuery = async (query, description) => {
        await page.waitForFunction(
            aboutDomRuntime,
            { timeout },
            {
                mode: "find",
                selectors: aboutSelectors,
                ...query,
            }
        );
        await waitHuman("short", timingOptions);
        const handle = await findHandle(query, description);
        if (!handle) {
            throw new FacebookPersonalProfileAboutError(
                `Не знайдено «${description}»`,
                {
                    code: "FACEBOOK_PERSONAL_ABOUT_ELEMENT_NOT_FOUND",
                    stage,
                    selector: query.selector ?? query.kind,
                }
            );
        }
        await clickHandle(handle, description);
    };

    const pauseAfterChange = async (preset = "short") => {
        await waitHuman(preset, timingOptions);
    };

    const markFailed = (name, error) => {
        const field = fieldStates[name];
        if (!field || field.status === facebookPersonalProfileAboutFieldStatuses.FAILED) {
            return;
        }
        field.status = facebookPersonalProfileAboutFieldStatuses.FAILED;
        field.error = {
            code: error?.code ?? "FACEBOOK_PERSONAL_ABOUT_FIELD_FAILED",
            message: error?.message ?? String(error),
        };
    };

    const dismissLeavePage = async (fromPrevious = true) => {
        const dialog = await inspect({ kind: "leavePageDialog" });
        if (!dialog?.found || !dialog.unsaved) return false;

        report(
            "facebook.personal_about.leave_page",
            "З’явилось попередження Leave Page? про незбережені зміни",
            { previousField }
        );
        if (fromPrevious && previousField) {
            markFailed(previousField, {
                code: "FACEBOOK_PERSONAL_ABOUT_UNSAVED_CHANGES",
                message: "Форму не підтверджено, Facebook показав Leave Page?",
            });
        }
        await clickFreshQuery({ kind: "leavePageButton" }, "Leave Page");
        await waitInspect(
            { kind: "leavePageDialog", expectAbsent: true },
            "закриття Leave Page?"
        );
        await pauseAfterChange("short");
        return true;
    };

    const dismissInvalidName = async () => {
        const dialog = await inspect({ kind: "invalidNameDialog" });
        if (!dialog?.found) return false;
        report(
            "facebook.personal_about.invalid_name",
            "Facebook показав Invalid Name",
            { previousField }
        );
        await clickFreshQuery({ kind: "invalidNameClose" }, "OK Invalid Name");
        await waitInspect(
            { kind: "invalidNameDialog", expectAbsent: true },
            "закриття Invalid Name"
        );
        await pauseAfterChange("short");
        return true;
    };

    const clickSectionSave = async (title, description) => {
        await waitInspect(
            {
                mode: "find",
                kind: "sectionField",
                title,
                field: "save",
            },
            `активний ${description}`
        );
        await clickFreshQuery(
            {
                kind: "sectionField",
                title,
                field: "save",
            },
            description
        );
    };

    const shortenAfterInvalidName = (value) => halfText(value);

    const openSideTab = async (selector, description) => {
        await clickFreshSelector(selector, description);
        await dismissLeavePage(true);
        await pauseAfterChange("short");
    };

    const typeIntoHandle = async (
        handle,
        value,
        label,
        { charByChar = true } = {}
    ) => {
        try {
            await humanClickElement(page, handle, {
                scrollDelay: [900, 1600],
                fallbackScrollDelay: [250, 500],
                beforeDelay: [80, 180],
                holdDelay: [60, 130],
                steps: [8, 16],
                ...timingOptions,
            });
            await handle.focus();
            await page.keyboard.down("Control");
            await page.keyboard.press("A");
            await page.keyboard.up("Control");
            await page.keyboard.press("Backspace");
            if (!value) {
                report(
                    "facebook.personal_about.input.cleared",
                    `Очищено поле «${label}»`
                );
                return;
            }
            report("facebook.personal_about.input.started", `Вводимо «${label}»`, {
                characters: [...value].length,
                charByChar,
            });
            if (charByChar) {
                for (const character of value) {
                    await page.keyboard.type(character);
                    await waitRandom(85, 230, timingOptions);
                }
            } else {
                const delay = 35 + Math.floor(random() * 56);
                await page.keyboard.type(value, { delay });
            }
        } finally {
            await handle.dispose().catch(() => {});
        }
    };

    const pickFirstSuggestion = async (inputSelector, label) => {
        const options = await inspect({
            kind: "comboboxOptions",
            inputSelector,
        });
        const texts = options?.options ?? [];
        if (texts.length === 0) return false;
        const addOnly = texts.length === 1 && isAddOptionText(texts[0]);
        const chosen = texts[0] ?? null;
        report(
            "facebook.personal_about.combobox.options",
            `Список «${label}»: ${texts.join(" | ") || "(порожньо)"}`,
            {
                options: texts,
                chosen,
                addOnly,
            }
        );
        await clickFreshQuery(
            {
                kind: "comboboxOption",
                inputSelector,
                index: 0,
            },
            addOnly ? `Add option «${chosen}»` : `перший option «${chosen}»`
        );
        await pauseAfterChange("short");
        return true;
    };

    const waitForSuggestionList = async (inputSelector, label) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            report(
                "facebook.personal_about.combobox.wait",
                `Чекаємо підказки «${label}», спроба ${attempt}/3`,
                { attempt, waitMs: 5000 }
            );
            try {
                await waitInspect(
                    {
                        kind: "comboboxOptions",
                        inputSelector,
                        expectReady: true,
                    },
                    `список «${label}» (${attempt}/3)`,
                    5000
                );
                return true;
            } catch {
                report(
                    "facebook.personal_about.combobox.missing",
                    `Підказки «${label}» не з’явились за 5 с`,
                    { attempt },
                    "warn"
                );
            }
        }
        return false;
    };

    const shortenUntilSuggestions = async (query, inputSelector, label) => {
        while (true) {
            const current = String(
                await inspect({
                    kind: "inputValue",
                    inputSelector,
                }) ?? ""
            );
            if (!current) {
                report(
                    "facebook.personal_about.combobox.exhausted",
                    `У «${label}» більше немає букв, підказки так і не з’явились`,
                    { label },
                    "warn"
                );
                return false;
            }
            report(
                "facebook.personal_about.combobox.trim",
                `Стираємо останню літеру в «${label}»`,
                {
                    remaining: current.length,
                    current,
                }
            );
            const handle = await findHandle(query, label);
            if (!handle) return false;
            try {
                await handle.focus();
                await page.keyboard.press("Backspace");
            } finally {
                await handle.dispose().catch(() => {});
            }
            await wait(3000, timingOptions);
            const ready = await inspect({
                kind: "comboboxOptions",
                inputSelector,
                expectReady: true,
            });
            if (ready) return true;
        }
    };

    const fillSuggestionField = async (
        query,
        value,
        label,
        inputSelector,
        { charByChar = false, required = true } = {}
    ) => {
        const handle = await findHandle(query, label);
        if (!handle) {
            throw new FacebookPersonalProfileAboutError(
                `Не знайдено поле «${label}»`,
                {
                    code: "FACEBOOK_PERSONAL_ABOUT_INPUT_NOT_FOUND",
                    stage,
                    selector: inputSelector,
                }
            );
        }
        await typeIntoHandle(handle, value, label, { charByChar });
        await pauseAfterChange("short");
        let ready = await waitForSuggestionList(inputSelector, label);
        if (!ready) {
            ready = await shortenUntilSuggestions(
                query,
                inputSelector,
                label
            );
        }
        if (ready) {
            await pickFirstSuggestion(inputSelector, label);
            return true;
        }
        if (required) {
            throw new FacebookPersonalProfileAboutError(
                `Список «${label}» не з’явився`,
                {
                    code: "FACEBOOK_PERSONAL_ABOUT_SUGGESTIONS_NOT_FOUND",
                    stage,
                    selector: inputSelector,
                }
            );
        }
        report(
            "facebook.personal_about.combobox.continue",
            `Йдемо далі без підказки «${label}»`,
            { label },
            "warn"
        );
        return false;
    };

    const closeOpenForm = async () => {
        const open = await inspect({ kind: "formOpen" });
        if (!open) return;
        await openSideTab(
            aboutSelectors.introTab,
            "Intro після незакритої форми"
        );
    };

    try {
        if (!page || typeof page.url !== "function" || !normalized) {
            status = facebookPersonalProfileAboutStatuses.INVALID_INPUT;
            throw new FacebookPersonalProfileAboutError(
                "Потрібна Puppeteer-сторінка та об’єкт fields",
                {
                    code: "FACEBOOK_PERSONAL_ABOUT_INVALID_INPUT",
                    stage,
                }
            );
        }

        if (!normalized.workRequested) {
            fieldStates.work.status =
                facebookPersonalProfileAboutFieldStatuses.SKIPPED;
        }
        if (!normalized.educationRequested) {
            fieldStates.education.status =
                facebookPersonalProfileAboutFieldStatuses.SKIPPED;
        }

        report(
            "facebook.personal_about.started",
            "Починаємо заповнення About",
            {
                bioRequested: true,
                workRequested: normalized.workRequested,
                educationRequested: normalized.educationRequested,
            }
        );
        await emitProgress(onProgress, {
            type: "about_started",
            fields: {
                bio: Boolean(normalized.bio),
                work: normalized.workRequested,
                education: normalized.educationRequested,
            },
        });

        stage = "OPEN_ABOUT";
        await clickFreshSelector(aboutSelectors.aboutTab, "вкладка About");
        await waitInspect({ kind: "aboutPanel" }, "бічна панель About");
        await pauseAfterChange("medium");

        stage = "BIO";
        await openSideTab(aboutSelectors.introTab, "вкладка Intro");
        await waitInspect(
            { kind: "sectionSnapshot", title: "Bio" },
            "секція Bio"
        );
        await pauseAfterChange("short");

        try {
            const snapshot = await inspect({
                kind: "sectionSnapshot",
                title: "Bio",
            });
            if (!snapshot?.found) {
                throw new FacebookPersonalProfileAboutError(
                    "Не знайдено секцію Bio",
                    {
                        code: "FACEBOOK_PERSONAL_ABOUT_BIO_SECTION_NOT_FOUND",
                        stage,
                    }
                );
            }

            const alreadyEmpty = !normalized.bio && !snapshot.hasEditBio;
            const alreadyMatches = Boolean(normalized.bio)
                && snapshot.hasEditBio
                && !snapshot.hasTextarea
                && sectionIncludes(snapshot, normalized.bio);

            if (alreadyEmpty) {
                fieldStates.bio.status =
                    facebookPersonalProfileAboutFieldStatuses.CLEARED;
                report(
                    "facebook.personal_about.field.skip",
                    "Біо вже порожнє",
                    { field: "bio", status: fieldStates.bio.status }
                );
            } else if (alreadyMatches) {
                fieldStates.bio.status =
                    facebookPersonalProfileAboutFieldStatuses.UPDATED;
                report(
                    "facebook.personal_about.field.unchanged",
                    "Видиме біо вже збігається з ціллю",
                    { field: "bio" }
                );
            } else {
                if (snapshot.hasEditBio) {
                    await clickFreshQuery(
                        {
                            kind: "sectionButtonByAria",
                            title: "Bio",
                            selector: aboutSelectors.editBio,
                        },
                        "Edit bio"
                    );
                } else {
                    await clickFreshQuery(
                        {
                            kind: "sectionButtonByText",
                            title: "Bio",
                            text: "About you",
                        },
                        "About you"
                    );
                }
                await waitInspect(
                    {
                        kind: "sectionSnapshot",
                        title: "Bio",
                        expectEditor: true,
                    },
                    "редактор Bio"
                );
                await pauseAfterChange("short");

                const editor = await inspect({
                    kind: "sectionSnapshot",
                    title: "Bio",
                });
                const textarea = await findHandle(
                    { kind: "sectionField", title: "Bio", field: "bio" },
                    "Introduce yourself"
                );
                if (!textarea) {
                    throw new FacebookPersonalProfileAboutError(
                        "Не знайдено textarea біо",
                        {
                            code: "FACEBOOK_PERSONAL_ABOUT_BIO_INPUT_NOT_FOUND",
                            stage,
                        }
                    );
                }
                const currentValue = await textarea.evaluate(
                    (input) => input.value ?? ""
                );
                const currentText = String(currentValue).trim();
                const targetText = normalized.bio ?? "";
                if (currentText === targetText) {
                    await textarea.dispose().catch(() => {});
                    if (editor.hasTextarea || editor.hasSave) {
                        await openSideTab(
                            aboutSelectors.introTab,
                            "Intro щоб закрити незмінене біо"
                        );
                    }
                    fieldStates.bio.status = targetText
                        ? facebookPersonalProfileAboutFieldStatuses.UPDATED
                        : facebookPersonalProfileAboutFieldStatuses.CLEARED;
                } else {
                    await typeIntoHandle(
                        textarea,
                        targetText,
                        "Introduce yourself",
                        { charByChar: true }
                    );
                    if (targetText) {
                        await waitInspect(
                            {
                                mode: "find",
                                kind: "sectionField",
                                title: "Bio",
                                field: "save",
                            },
                            "активний Save біо"
                        );
                        await clickFreshQuery(
                            {
                                kind: "sectionField",
                                title: "Bio",
                                field: "save",
                            },
                            "Save біо"
                        );
                    } else {
                        const saveHandle = await findHandle(
                            {
                                kind: "sectionField",
                                title: "Bio",
                                field: "save",
                            },
                            "активний Save біо"
                        );
                        if (saveHandle) {
                            await clickHandle(saveHandle, "Save біо");
                        } else if (editor.hasTextarea || editor.hasSave) {
                            await openSideTab(
                                aboutSelectors.introTab,
                                "Intro після порожнього біо без Save"
                            );
                        }
                    }
                    await waitInspect(
                        { kind: "bioOutcome" },
                        "поля біо зникли після Save"
                    );
                    await pauseAfterChange("short");
                    if (await dismissLeavePage(false)) {
                        throw new FacebookPersonalProfileAboutError(
                            "Біо не збережено",
                            {
                                code: "FACEBOOK_PERSONAL_ABOUT_BIO_UNSAVED",
                                stage,
                            }
                        );
                    }
                    if (await dismissInvalidName()) {
                        throw new FacebookPersonalProfileAboutError(
                            "Facebook відхилив біо",
                            {
                                code: "FACEBOOK_PERSONAL_ABOUT_BIO_INVALID",
                                stage,
                            }
                        );
                    }
                    fieldStates.bio.status = targetText
                        ? facebookPersonalProfileAboutFieldStatuses.UPDATED
                        : facebookPersonalProfileAboutFieldStatuses.CLEARED;
                }
            }
        } catch (error) {
            markFailed("bio", error);
            report(
                "facebook.personal_about.field.failed",
                "Не вдалося обробити біо",
                { error: fieldStates.bio.error },
                "error"
            );
            await dismissInvalidName().catch(() => {});
            await dismissLeavePage(false).catch(() => {});
        }
        previousField = "bio";
        await emitProgress(onProgress, {
            type: "about_field_finished",
            field: "bio",
            status: fieldStates.bio.status,
        });

        if (normalized.workRequested) {
            stage = "WORK";
            await openSideTab(aboutSelectors.workTab, "вкладка Work");
            try {
                await waitInspect(
                    { kind: "workTabReady" },
                    "секція Work і кнопка Work experience"
                );
            } catch (error) {
                const headings = await inspect({ kind: "sectionHeadings" })
                    .catch(() => []);
                report(
                    "facebook.personal_about.work.section_missing",
                    "Після вкладки Work не знайдено секцію або кнопку",
                    { headings },
                    "error"
                );
                throw new FacebookPersonalProfileAboutError(
                    "Не знайдено секцію Work або кнопку Work experience",
                    {
                        code: "FACEBOOK_PERSONAL_ABOUT_WORK_SECTION_NOT_FOUND",
                        stage,
                        cause: error,
                    }
                );
            }
            await pauseAfterChange("short");
            try {
                const snapshot = await inspect({
                    kind: "sectionSnapshot",
                    title: "Work",
                });
                if (!snapshot?.found) {
                    throw new FacebookPersonalProfileAboutError(
                        "Не знайдено секцію Work",
                        {
                            code: "FACEBOOK_PERSONAL_ABOUT_WORK_SECTION_NOT_FOUND",
                            stage,
                        }
                    );
                }
                if (snapshot.hasEditWorkplace) {
                    fieldStates.work.status =
                        facebookPersonalProfileAboutFieldStatuses.SKIPPED;
                    fieldStates.work.skipReason =
                        facebookPersonalProfileAboutSkipReasons.ALREADY_EXISTS;
                    report(
                        "facebook.personal_about.field.skip",
                        "Робота вже є, другий запис не додаємо",
                        {
                            field: "work",
                            skipReason: fieldStates.work.skipReason,
                        }
                    );
                } else {
                    await clickFreshQuery(
                        {
                            kind: "sectionButtonByText",
                            title: "Work",
                            text: "Work experience",
                            buttonSelector: '[role="button"][tabindex="0"]',
                        },
                        "кнопка Work experience"
                    );
                    await waitInspect(
                        {
                            kind: "sectionSnapshot",
                            title: "Work",
                            expectEditor: true,
                        },
                        "форма Work"
                    );
                    await pauseAfterChange("short");
                    await fillSuggestionField(
                        {
                            kind: "sectionField",
                            title: "Work",
                            field: "company",
                        },
                        normalized.work.company,
                        "Company",
                        aboutSelectors.company
                    );
                    await waitInspect(
                        {
                            mode: "find",
                            kind: "sectionField",
                            title: "Work",
                            field: "position",
                        },
                        "поле Position"
                    );
                    await fillSuggestionField(
                        {
                            kind: "sectionField",
                            title: "Work",
                            field: "position",
                        },
                        normalized.work.position,
                        "Position",
                        aboutSelectors.position,
                        { charByChar: true }
                    );
                    let companyValue = normalized.work.company;
                    let positionValue = normalized.work.position;
                    while (true) {
                        await clickSectionSave("Work", "Save роботи");
                        const outcome = await waitInspectValue(
                            { kind: "workSaveOutcome" },
                            "результат Save роботи"
                        );
                        await pauseAfterChange("short");
                        if (outcome?.saved) {
                            fieldStates.work.status =
                                facebookPersonalProfileAboutFieldStatuses.FILLED;
                            break;
                        }
                        const rejectedWorkName = Boolean(outcome?.invalidName)
                            || await dismissInvalidName();
                        if (outcome?.invalidName) {
                            await dismissInvalidName();
                        }
                        if (rejectedWorkName) {
                            companyValue = shortenAfterInvalidName(companyValue);
                            positionValue = shortenAfterInvalidName(
                                positionValue
                            );
                            report(
                                "facebook.personal_about.invalid_name.retry",
                                "Скорочуємо компанію і посаду після Invalid Name",
                                {
                                    company: companyValue,
                                    position: positionValue,
                                },
                                "warn"
                            );
                            if (!companyValue && !positionValue) {
                                throw new FacebookPersonalProfileAboutError(
                                    "Facebook відхилив роботу, текст скоротився до порожнього",
                                    {
                                        code: "FACEBOOK_PERSONAL_ABOUT_INVALID_NAME",
                                        stage,
                                    }
                                );
                            }
                            if (companyValue) {
                                await fillSuggestionField(
                                    {
                                        kind: "sectionField",
                                        title: "Work",
                                        field: "company",
                                    },
                                    companyValue,
                                    "Company",
                                    aboutSelectors.company
                                );
                            }
                            if (positionValue) {
                                await fillSuggestionField(
                                    {
                                        kind: "sectionField",
                                        title: "Work",
                                        field: "position",
                                    },
                                    positionValue,
                                    "Position",
                                    aboutSelectors.position,
                                    { charByChar: true }
                                );
                            }
                            continue;
                        }
                        if (await dismissLeavePage(false)) {
                            throw new FacebookPersonalProfileAboutError(
                                "Роботу не збережено",
                                {
                                    code: "FACEBOOK_PERSONAL_ABOUT_WORK_UNSAVED",
                                    stage,
                                }
                            );
                        }
                        throw new FacebookPersonalProfileAboutError(
                            "Роботу не збережено",
                            {
                                code: "FACEBOOK_PERSONAL_ABOUT_WORK_NOT_SAVED",
                                stage,
                            }
                        );
                    }
                }
            } catch (error) {
                markFailed("work", error);
                report(
                    "facebook.personal_about.field.failed",
                    "Не вдалося заповнити роботу",
                    { error: fieldStates.work.error },
                    "error"
                );
                await dismissInvalidName().catch(() => {});
                await dismissLeavePage(false).catch(() => {});
            }
            previousField = "work";
            await emitProgress(onProgress, {
                type: "about_field_finished",
                field: "work",
                status: fieldStates.work.status,
            });
        }

        if (normalized.educationRequested) {
            stage = "EDUCATION";
            await openSideTab(
                aboutSelectors.educationTab,
                "вкладка Education"
            );
            await waitInspect(
                { kind: "sectionSnapshot", title: "College" },
                "секція College"
            );
            await pauseAfterChange("short");
            try {
                const snapshot = await inspect({
                    kind: "sectionSnapshot",
                    title: "College",
                });
                if (!snapshot?.found) {
                    throw new FacebookPersonalProfileAboutError(
                        "Не знайдено секцію College",
                        {
                            code: "FACEBOOK_PERSONAL_ABOUT_COLLEGE_SECTION_NOT_FOUND",
                            stage,
                        }
                    );
                }
                if (snapshot.hasEditCollege) {
                    fieldStates.education.status =
                        facebookPersonalProfileAboutFieldStatuses.SKIPPED;
                    fieldStates.education.skipReason =
                        facebookPersonalProfileAboutSkipReasons.ALREADY_EXISTS;
                    report(
                        "facebook.personal_about.field.skip",
                        "Коледж уже є, другий запис не додаємо",
                        {
                            field: "education",
                            skipReason: fieldStates.education.skipReason,
                        }
                    );
                } else {
                    await clickFreshQuery(
                        {
                            kind: "sectionButtonByText",
                            title: "College",
                            text: "College",
                        },
                        "кнопка College"
                    );
                    await waitInspect(
                        {
                            kind: "sectionSnapshot",
                            title: "College",
                            expectEditor: true,
                        },
                        "форма College"
                    );
                    await pauseAfterChange("short");
                    await fillSuggestionField(
                        {
                            kind: "sectionField",
                            title: "College",
                            field: "college",
                        },
                        normalized.education,
                        "College name",
                        aboutSelectors.collegeName
                    );
                    let educationValue = normalized.education;
                    while (true) {
                        await clickSectionSave("College", "Save коледжу");
                        const outcome = await waitInspectValue(
                            { kind: "collegeSaveOutcome" },
                            "результат Save коледжу"
                        );
                        await pauseAfterChange("short");
                        if (outcome?.saved) {
                            fieldStates.education.status =
                                facebookPersonalProfileAboutFieldStatuses.FILLED;
                            break;
                        }
                        const rejectedCollegeName = Boolean(
                            outcome?.invalidName
                        ) || await dismissInvalidName();
                        if (outcome?.invalidName) {
                            await dismissInvalidName();
                        }
                        if (rejectedCollegeName) {
                            educationValue = shortenAfterInvalidName(
                                educationValue
                            );
                            report(
                                "facebook.personal_about.invalid_name.retry",
                                "Скорочуємо освіту після Invalid Name",
                                { education: educationValue },
                                "warn"
                            );
                            if (!educationValue) {
                                throw new FacebookPersonalProfileAboutError(
                                    "Facebook відхилив назву коледжу",
                                    {
                                        code: "FACEBOOK_PERSONAL_ABOUT_INVALID_NAME",
                                        stage,
                                    }
                                );
                            }
                            await fillSuggestionField(
                                {
                                    kind: "sectionField",
                                    title: "College",
                                    field: "college",
                                },
                                educationValue,
                                "College name",
                                aboutSelectors.collegeName
                            );
                            continue;
                        }
                        throw new FacebookPersonalProfileAboutError(
                            "Коледж не збережено",
                            {
                                code: "FACEBOOK_PERSONAL_ABOUT_COLLEGE_NOT_SAVED",
                                stage,
                            }
                        );
                    }
                }
            } catch (error) {
                markFailed("education", error);
                report(
                    "facebook.personal_about.field.failed",
                    "Не вдалося заповнити освіту",
                    { error: fieldStates.education.error },
                    "error"
                );
                await dismissInvalidName().catch(() => {});
                await dismissLeavePage(false).catch(() => {});
            }
            previousField = "education";
            await emitProgress(onProgress, {
                type: "about_field_finished",
                field: "education",
                status: fieldStates.education.status,
            });
        }

        const lastFailed = ["education", "work", "bio"].find((name) =>
            fieldStates[name].status
                === facebookPersonalProfileAboutFieldStatuses.FAILED
        );
        if (lastFailed) {
            await closeOpenForm().catch(() => {});
        }

        const requested = Object.values(fieldStates).filter((item) =>
            item.requested
        );
        const hasFailed = requested.some((item) =>
            item.status === facebookPersonalProfileAboutFieldStatuses.FAILED
        );
        status = hasFailed
            ? facebookPersonalProfileAboutStatuses.PARTIAL
            : facebookPersonalProfileAboutStatuses.COMPLETED;
        stage = hasFailed ? stage : "COMPLETED";
    } catch (error) {
        if (status !== facebookPersonalProfileAboutStatuses.INVALID_INPUT) {
            status = facebookPersonalProfileAboutStatuses.ERROR;
        }
        errorDetails = {
            code: error?.code ?? `FACEBOOK_PERSONAL_ABOUT_${stage}_FAILED`,
            message: error?.message ?? String(error),
            stage,
        };
        report(
            "facebook.personal_about.failed",
            errorDetails.message,
            { error: errorDetails },
            "error"
        );
        if (fieldStates.bio.status == null) {
            markFailed("bio", errorDetails);
        }
        if (fieldStates.work.requested && fieldStates.work.status == null) {
            markFailed("work", errorDetails);
        }
        if (
            fieldStates.education.requested
            && fieldStates.education.status == null
        ) {
            markFailed("education", errorDetails);
        }
        await dismissInvalidName().catch(() => {});
        await dismissLeavePage(false).catch(() => {});
    }

    const requested = Object.values(fieldStates).filter((item) => item.requested);
    const hasFailed = requested.some((item) =>
        item.status === facebookPersonalProfileAboutFieldStatuses.FAILED
    );
    const success = status === facebookPersonalProfileAboutStatuses.COMPLETED
        && !hasFailed;
    const result = {
        success,
        status,
        stage: success ? "COMPLETED" : stage,
        fields: {
            bio: {
                status: fieldStates.bio.status,
                requested: fieldStates.bio.requested,
                error: fieldStates.bio.error,
            },
            work: {
                status: fieldStates.work.status,
                requested: fieldStates.work.requested,
                skipReason: fieldStates.work.skipReason,
                error: fieldStates.work.error,
            },
            education: {
                status: fieldStates.education.status,
                requested: fieldStates.education.requested,
                skipReason: fieldStates.education.skipReason,
                error: fieldStates.education.error,
            },
        },
        startedAt,
        finishedAt: new Date().toISOString(),
        finalUrl: typeof page?.url === "function" ? page.url() : null,
        error: errorDetails,
    };
    report(
        success
            ? "facebook.personal_about.completed"
            : "facebook.personal_about.partial",
        success
            ? "About заповнено без провалених кроків"
            : "Заповнення About завершено не повністю",
        {
            status,
            fields: result.fields,
        },
        success ? "info" : "error"
    );
    await emitProgress(onProgress, {
        type: "about_finished",
        success,
        status,
        fields: result.fields,
    });
    return result;
}
