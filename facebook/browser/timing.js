export const HUMAN_DELAY_PRESETS = Object.freeze({
    short: Object.freeze({ minimum: 800, maximum: 1500 }),
    medium: Object.freeze({ minimum: 1500, maximum: 3000 }),
    long: Object.freeze({ minimum: 3000, maximum: 5000 }),
    veryLong: Object.freeze({ minimum: 5000, maximum: 7000 }),
    extraLong: Object.freeze({ minimum: 7000, maximum: 10000 }),
});


function validateRange(minimum, maximum) {
    if (
        !Number.isInteger(minimum)
        || !Number.isInteger(maximum)
        || minimum < 0
        || maximum < minimum
    ) {
        throw new RangeError(
            `Некоректний діапазон затримки: ${minimum}–${maximum}`
        );
    }
}


function defaultSleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


export function randomInteger(
    minimum,
    maximum,
    { random = Math.random } = {}
) {
    validateRange(minimum, maximum);

    const value = random();

    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError(
            "Функція random повинна повертати число від 0 включно до 1 невключно"
        );
    }

    return minimum + Math.floor(value * (maximum - minimum + 1));
}


export async function wait(
    milliseconds,
    { sleep = defaultSleep } = {}
) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new RangeError(
            `Некоректна тривалість затримки: ${milliseconds}`
        );
    }

    await sleep(milliseconds);
    return milliseconds;
}


export async function waitRandom(
    minimum,
    maximum,
    {
        random = Math.random,
        sleep = defaultSleep,
        onDelay = null,
    } = {}
) {
    const delayMs = randomInteger(minimum, maximum, { random });

    if (typeof onDelay === "function") {
        await onDelay(delayMs);
    }

    await sleep(delayMs);
    return delayMs;
}


export async function waitHuman(preset, options = {}) {
    const range = HUMAN_DELAY_PRESETS[preset];

    if (!range) {
        throw new RangeError(
            `Невідомий пресет human-like затримки: ${preset}`
        );
    }

    return waitRandom(range.minimum, range.maximum, options);
}
