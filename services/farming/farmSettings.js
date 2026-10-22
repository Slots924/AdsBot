export const farmActionLabels = Object.freeze({
    feed: "Перегляд домашньої стрічки",
    openPosts: "Відкриття постів",
    likePosts: "Лайки постів",
    likeComments: "Лайки коментарів",
    groups: "Перегляд Facebook-груп",
    joinGroups: "Вступ у Facebook-групи",
});

export const defaultFarmSettings = Object.freeze({
    workers: 1, timeoutSeconds: 500, disableImages: false, headless: false,
    actions: {
        feed: { enabled: false, count: 10, minSeconds: 5, maxSeconds: 15, upPercent: 10 },
        openPosts: { enabled: false, count: 3, minSeconds: 5, maxSeconds: 15 },
        likePosts: { enabled: false, percent: 10, max: 2 },
        likeComments: { enabled: false, posts: 3, percent: 10, max: 2 },
        groups: { enabled: false, count: 2, posts: 5, minSeconds: 5, maxSeconds: 15 },
        joinGroups: { enabled: false, max: 1 },
    },
});

export function normalizeFarmSettings(input = {}) {
    const result = { ...defaultFarmSettings, ...input, actions: {} };
    const integer = (value, min, max, label) => {
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Некоректне значення: ${label} (${min}–${max})`);
        return value;
    };
    integer(result.workers, 1, 5, "воркери");
    integer(result.timeoutSeconds, 1, 86400, "таймаут");
    result.disableImages = input.disableImages === true;
    result.headless = input.headless === true;
    for (const [key, defaults] of Object.entries(defaultFarmSettings.actions)) {
        const action = { ...defaults, ...input.actions?.[key] };
        action.enabled = action.enabled === true;
        for (const field of Object.keys(defaults).filter((name) => name !== "enabled")) {
            integer(action[field], 0, field.toLowerCase().includes("percent") ? 100 : 10000, `${farmActionLabels[key]}: ${field}`);
        }
        if (action.minSeconds > action.maxSeconds) throw new Error("Мінімальна пауза перевищує максимальну");
        result.actions[key] = action;
    }
    return { workers: result.workers, timeoutSeconds: result.timeoutSeconds,
        disableImages: result.disableImages, headless: result.headless, actions: result.actions };
}

export function normalizeFacebookGroup(input) {
    const url = new URL(String(input.url ?? "").trim());
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com"].includes(url.hostname)
        || !/^\/groups\/[\w.-]+\/?$/.test(url.pathname)) throw new Error("Вкажіть https://www.facebook.com/groups/назва-або-id");
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Вкажіть назву Facebook-групи");
    return { id: String(input.id ?? ""), name, url: `https://www.facebook.com${url.pathname.replace(/\/$/, "")}`,
        topic: String(input.topic ?? "").trim(), enabled: input.enabled === true,
        checkedAt: input.checkedAt ? new Date(input.checkedAt).toISOString() : null };
}
