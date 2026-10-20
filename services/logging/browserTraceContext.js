const traces = new WeakMap();

export function getBrowserTrace(page) {
    return page && traces.get(page);
}

export function bindBrowserTrace(page, trace) {
    const previous = traces.get(page);
    traces.set(page, trace);
    return () => {
        if (previous) traces.set(page, previous);
        else traces.delete(page);
    };
}
