import {
    randomInteger,
    wait,
    waitHuman,
    waitRandom,
} from "./timing.js";


async function emit(onEvent, type, details = {}) {
    if (typeof onEvent !== "function") {
        return;
    }

    try {
        await onEvent({ type, ...details });
    } catch {
        // Помилка telemetry не повинна блокувати browser interaction
    }
}


async function applyDelay(delay, timingOptions, onEvent, reason) {
    if (delay === null || delay === undefined) {
        return null;
    }

    let delayMs;
    const onDelay = async (value) => {
        delayMs = value;
        await emit(onEvent, "delay", { delayMs: value, reason });
    };

    if (typeof delay === "number") {
        delayMs = delay;
        await emit(onEvent, "delay", { delayMs, reason });
        await wait(delay, timingOptions);
        return delayMs;
    }

    if (typeof delay === "string") {
        return waitHuman(delay, { ...timingOptions, onDelay });
    }

    if (
        Array.isArray(delay)
        && delay.length === 2
    ) {
        return waitRandom(delay[0], delay[1], {
            ...timingOptions,
            onDelay,
        });
    }

    throw new TypeError("Некоректне налаштування затримки pointer interaction");
}


function validateRange(range, name) {
    if (
        !Array.isArray(range)
        || range.length !== 2
        || !Number.isFinite(range[0])
        || !Number.isFinite(range[1])
        || range[0] < 0
        || range[1] < range[0]
    ) {
        throw new RangeError(`Некоректний діапазон ${name}`);
    }
}


export async function moveMouseToElement(
    page,
    element,
    {
        scrollIntoView = true,
        scrollBehavior = "smooth",
        scrollBlock = "center",
        scrollInline = "center",
        scrollDelay = null,
        fallbackScrollDelay = [250, 500],
        inset = [0.25, 0.75],
        steps = [8, 18],
        random = Math.random,
        sleep,
        onEvent = null,
    } = {}
) {
    validateRange(inset, "inset");
    validateRange(steps, "steps");

    if (inset[1] > 1) {
        throw new RangeError("Значення inset не може перевищувати 1");
    }

    const timingOptions = { random, ...(sleep ? { sleep } : {}) };

    if (scrollIntoView) {
        await element.evaluate(
            (target, behavior, block, inline) => {
                target.scrollIntoView({ behavior, block, inline });
            },
            scrollBehavior,
            scrollBlock,
            scrollInline
        );
        await emit(onEvent, "scroll_into_view", {
            behavior: scrollBehavior,
            block: scrollBlock,
            inline: scrollInline,
        });
        await applyDelay(
            scrollDelay,
            timingOptions,
            onEvent,
            "scroll_into_view"
        );
    }

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

    if (outsideViewport && scrollIntoView) {
        await emit(onEvent, "scroll_fallback", { box, viewport });
        await element.evaluate((target, block, inline) => {
            target.scrollIntoView({
                behavior: "auto",
                block,
                inline,
            });
        }, scrollBlock, scrollInline);
        await applyDelay(
            fallbackScrollDelay,
            timingOptions,
            onEvent,
            "scroll_fallback"
        );
        box = await element.boundingBox();
    }

    if (!box) {
        const error = new Error(
            "Не вдалося визначити координати browser element"
        );
        error.code = "BROWSER_ELEMENT_NO_BOUNDING_BOX";
        throw error;
    }

    if (
        scrollIntoView
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
        )
    ) {
        const error = new Error(
            "Browser element залишився поза viewport після прокрутки"
        );
        error.code = "BROWSER_ELEMENT_OUTSIDE_VIEWPORT";
        throw error;
    }

    const xRatio = inset[0] + random() * (inset[1] - inset[0]);
    const yRatio = inset[0] + random() * (inset[1] - inset[0]);
    const stepCount = randomInteger(steps[0], steps[1], { random });
    const x = box.x + box.width * xRatio;
    const y = box.y + box.height * yRatio;

    await emit(onEvent, "mouse_move", {
        x,
        y,
        steps: stepCount,
        box,
    });
    await page.mouse.move(x, y, { steps: stepCount });

    return { x, y, steps: stepCount, box };
}


export async function clickLeftMouse(
    page,
    {
        beforeDelay = null,
        holdDelay = [70, 160],
        random = Math.random,
        sleep,
        onEvent = null,
    } = {}
) {
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };

    await applyDelay(
        beforeDelay,
        timingOptions,
        onEvent,
        "before_click"
    );
    await page.mouse.down({ button: "left" });
    await emit(onEvent, "mouse_down", { button: "left" });
    const holdDelayMs = await applyDelay(
        holdDelay,
        timingOptions,
        onEvent,
        "mouse_hold"
    );
    await page.mouse.up({ button: "left" });
    await emit(onEvent, "mouse_up", { button: "left" });

    return { holdDelayMs };
}


export async function humanClickElement(
    page,
    element,
    options = {}
) {
    const movement = await moveMouseToElement(page, element, options);
    const click = await clickLeftMouse(page, options);

    return { ...movement, ...click };
}
