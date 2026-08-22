import { waitForVisibleElement } from "./elements.js";


const validPositions = new Set(["top", "center", "bottom"]);


function normalizeOptions(options = {}) {
    const normalized = {
        position: options.position ?? "center",
        jitterPx: options.jitterPx ?? 50,
        durationMs: options.durationMs ?? 800,
        stepRange: options.stepRange ?? [10, 25],
        randomValue: (options.random ?? Math.random)(),
    };

    if (!validPositions.has(normalized.position)) {
        throw new RangeError(
            `Некоректна позиція human-like scroll: ${normalized.position}`
        );
    }

    if (!Number.isFinite(normalized.jitterPx) || normalized.jitterPx < 0) {
        throw new RangeError("jitterPx має бути невід’ємним числом");
    }

    if (!Number.isFinite(normalized.durationMs) || normalized.durationMs < 0) {
        throw new RangeError("durationMs має бути невід’ємним числом");
    }

    if (
        !Array.isArray(normalized.stepRange)
        || normalized.stepRange.length !== 2
        || normalized.stepRange[0] <= 0
        || normalized.stepRange[1] < normalized.stepRange[0]
    ) {
        throw new RangeError("Некоректний stepRange human-like scroll");
    }

    if (
        !Number.isFinite(normalized.randomValue)
        || normalized.randomValue < 0
        || normalized.randomValue >= 1
    ) {
        throw new RangeError(
            "Функція random повинна повертати число від 0 включно до 1 невключно"
        );
    }

    return normalized;
}


export async function humanScrollToElement(page, element, options = {}) {
    const config = normalizeOptions(options);

    return page.evaluate(async (target, scrollConfig) => {
        const getScrollContainer = (candidate) => {
            let container = candidate.parentElement;

            while (container && container !== document.body) {
                const { overflowY } = getComputedStyle(container);

                if (overflowY === "auto" || overflowY === "scroll") {
                    return container;
                }

                container = container.parentElement;
            }

            return window;
        };
        const container = getScrollContainer(target);
        const rectangle = target.getBoundingClientRect();
        const containerRectangle = container === window
            ? { top: 0, height: window.innerHeight }
            : container.getBoundingClientRect();
        const containerTop = container === window
            ? 0
            : containerRectangle.top;
        const startPosition = container === window
            ? window.scrollY
            : container.scrollTop;
        let basePosition;

        if (scrollConfig.position === "top") {
            basePosition = rectangle.top - containerTop + startPosition;
        } else if (scrollConfig.position === "bottom") {
            basePosition = rectangle.bottom
                - containerTop
                + startPosition
                - containerRectangle.height;
        } else {
            basePosition = rectangle.top
                - containerTop
                + startPosition
                + rectangle.height / 2
                - containerRectangle.height / 2;
        }

        const targetPosition = basePosition
            + (scrollConfig.randomValue - 0.5)
            * 2
            * scrollConfig.jitterPx;
        const simulateWheel = () => new Promise((resolve) => {
            const distance = targetPosition - startPosition;
            const startedAt = performance.now();
            const ease = (progress) =>
                -(Math.cos(Math.PI * progress) - 1) / 2;

            const animate = (time) => {
                const progress = Math.min(
                    (time - startedAt) / Math.max(scrollConfig.durationMs, 1),
                    1
                );
                const current = startPosition + distance * ease(progress);
                const currentPosition = container === window
                    ? window.scrollY
                    : container.scrollTop;
                const delta = current - currentPosition;

                if (Math.abs(delta) > 1) {
                    const randomStep = scrollConfig.stepRange[0]
                        + scrollConfig.randomValue
                        * (scrollConfig.stepRange[1]
                            - scrollConfig.stepRange[0]);
                    const step = Math.min(randomStep, Math.abs(delta));
                    const wheelDelta = delta > 0 ? step : -step;

                    container.dispatchEvent(new WheelEvent("wheel", {
                        deltaY: wheelDelta,
                        bubbles: true,
                    }));

                    if (container === window) {
                        window.scrollBy(0, wheelDelta);
                    } else {
                        container.scrollTop += wheelDelta;
                    }
                }

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });

        try {
            container.scrollTo({
                top: targetPosition,
                behavior: "smooth",
            });
            await new Promise((resolve) => {
                setTimeout(resolve, scrollConfig.durationMs);
            });
        } catch {
            try {
                await simulateWheel();
            } catch {
                if (container === window) {
                    window.scrollTo(0, targetPosition);
                } else {
                    container.scrollTop = targetPosition;
                }
            }
        }

        return {
            container: container === window ? "window" : "element",
            startPosition,
            targetPosition,
        };
    }, element, config);
}


export async function humanScrollToSelector(
    page,
    selector,
    {
        index = 0,
        timeout = 15000,
        ...options
    } = {}
) {
    if (!Number.isInteger(index) || index < 0) {
        throw new RangeError(
            `Індекс scroll target має бути невід’ємним цілим числом: ${index}`
        );
    }

    const element = await waitForVisibleElement(page, selector, {
        timeout,
        index,
    });

    try {
        return await humanScrollToElement(page, element, options);
    } finally {
        await element.dispose().catch(() => {});
    }
}
