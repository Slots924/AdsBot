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


async function scrollToPostLikeButton(page) {
    try {
        await page.evaluate(async () => {
            // Налаштування прокручування
            const config = {
                targetIndex: 1,
                parentSelector:
                    'div[role="dialog"] div[class^="html-div"] > * > div[data-visualcompletion="ignore-dynamic"] > div > div:nth-of-type(1)',
                basePosition: "center",
                randomRange: 50,
                smoothness: 800,
                stepMin: 10,
                stepMax: 25,
            };

            try {
                // Перевіряємо налаштування
                const targetIndex = parseInt(
                    config.targetIndex,
                    10
                );

                if (
                    Number.isNaN(targetIndex) ||
                    targetIndex < 1
                ) {
                    throw new Error(
                        `Некоректний індекс: ${config.targetIndex}`
                    );
                }

                const validPositions = [
                    "top",
                    "center",
                    "bottom",
                ];

                if (
                    !validPositions.includes(
                        config.basePosition
                    )
                ) {
                    throw new Error(
                        `Некоректна позиція: ${config.basePosition}`
                    );
                }

                // Очікуємо появу елементів
                async function waitForElements(
                    selector,
                    timeout = 15000
                ) {
                    const start = Date.now();

                    while (Date.now() - start < timeout) {
                        const elements = Array.from(
                            document.querySelectorAll(selector)
                        );

                        if (elements.length) {
                            return elements;
                        }

                        // Невеликий рух запускає ліниве завантаження
                        window.scrollBy(0, 10);

                        await new Promise((resolve) => {
                            setTimeout(resolve, 300);
                        });
                    }

                    throw new Error(
                        `Не знайдено елемент: ${selector}`
                    );
                }

                // Отримуємо цільовий елемент
                const items = await waitForElements(
                    config.parentSelector
                );

                if (targetIndex > items.length) {
                    throw new Error(
                        `Індекс перевищує кількість елементів: ${items.length}`
                    );
                }

                const target = items[targetIndex - 1];

                // Шукаємо контейнер із прокручуванням
                const getScrollContainer = (element) => {
                    let container = element.parentElement;

                    while (
                        container &&
                        container !== document.body
                    ) {
                        const { overflowY } =
                            getComputedStyle(container);

                        if (
                            overflowY === "auto" ||
                            overflowY === "scroll"
                        ) {
                            return container;
                        }

                        container = container.parentElement;
                    }

                    return window;
                };

                const container =
                    getScrollContainer(target);

                // Розраховуємо цільову позицію
                const rect =
                    target.getBoundingClientRect();
                const containerRect =
                    container === window
                        ? {
                            top: 0,
                            height: window.innerHeight,
                        }
                        : container.getBoundingClientRect();
                const containerTop =
                    container === window
                        ? 0
                        : containerRect.top;
                const scrollTop =
                    container.scrollTop || window.scrollY;

                let basePosition;

                switch (config.basePosition) {
                    case "top":
                        basePosition =
                            rect.top -
                            containerTop +
                            scrollTop;
                        break;

                    case "center":
                        basePosition =
                            rect.top -
                            containerTop +
                            scrollTop +
                            rect.height / 2 -
                            containerRect.height / 2;
                        break;

                    case "bottom":
                        basePosition =
                            rect.bottom -
                            containerTop +
                            scrollTop -
                            containerRect.height;
                        break;
                }

                const targetPosition =
                    basePosition +
                    (Math.random() - 0.5) *
                    2 *
                    config.randomRange;

                // Виконуємо плавне прокручування
                const scroll = (position) => {
                    container.scrollTo({
                        top: position,
                        behavior: "smooth",
                    });
                };

                // Імітуємо прокручування колесом
                const simulateWheel = (position) =>
                    new Promise((resolve) => {
                        const startPosition =
                            container.scrollTop ||
                            window.scrollY;
                        const distance =
                            position - startPosition;
                        const startTime =
                            performance.now();

                        const ease = (progress) =>
                            -(
                                Math.cos(
                                    Math.PI * progress
                                ) - 1
                            ) / 2;

                        const animate = (time) => {
                            const progress = Math.min(
                                (
                                    time - startTime
                                ) / config.smoothness,
                                1
                            );
                            const current =
                                startPosition +
                                distance * ease(progress);
                            const delta =
                                current -
                                (
                                    container.scrollTop ||
                                    window.scrollY
                                );

                            if (Math.abs(delta) > 1) {
                                const step = Math.min(
                                    Math.max(
                                        config.stepMin,
                                        Math.random() *
                                        config.stepMax
                                    ),
                                    Math.abs(delta)
                                );
                                const wheelDelta =
                                    delta > 0
                                        ? step
                                        : -step;

                                container.dispatchEvent(
                                    new WheelEvent(
                                        "wheel",
                                        {
                                            deltaY:
                                                wheelDelta,
                                            bubbles: true,
                                        }
                                    )
                                );

                                if (container === window) {
                                    window.scrollBy(
                                        0,
                                        wheelDelta
                                    );
                                } else {
                                    container.scrollTop +=
                                        wheelDelta;
                                }
                            }

                            if (progress < 1) {
                                requestAnimationFrame(
                                    animate
                                );
                            } else {
                                resolve();
                            }
                        };

                        requestAnimationFrame(animate);
                    });

                // Пробуємо доступні способи прокручування
                try {
                    scroll(targetPosition);

                    await new Promise((resolve) => {
                        setTimeout(
                            resolve,
                            config.smoothness
                        );
                    });
                } catch {
                    try {
                        await simulateWheel(
                            targetPosition
                        );
                    } catch {
                        if (container === window) {
                            window.scrollTo(
                                0,
                                targetPosition
                            );
                        } else {
                            container.scrollTop =
                                targetPosition;
                        }
                    }
                }
            } catch {
                // Помилка прокручування не зупиняє програму
            }
        });
    } catch {
        // Помилка Puppeteer не зупиняє програму
    } finally {
        await waitRandom(975, 1250);
    }
}


export default scrollToPostLikeButton;
