// Виконується у браузері; поля та сторонній вміст не потрапляють у діагностику форм.
export function inspectTraceDom({ uiTexts = [], sensitiveTexts = [], selector = null,
    maxNodes = 180, aboutPanelSelector = null } = {}) {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const known = new Set(uiTexts.map((value) => normalize(value).toLocaleLowerCase()));
    const aboutContext = aboutPanelSelector && document.querySelector(aboutPanelSelector);
    const secrets = [...sensitiveTexts, ...[...document.querySelectorAll("input,textarea")].map((node) => node.value)]
        .filter((value) => typeof value === "string").map(normalize).filter((value) => value.length > 2)
        .sort((left, right) => right.length - left.length);
    const text = (value, allowUnknown = false) => {
        const normalized = normalize(value);
        if (known.has(normalized.toLocaleLowerCase())) return normalized;
        if (!normalized) return "";
        if (!allowUnknown) return "[приховано]";
        let safe = normalized;
        for (const secret of secrets) {
            safe = safe.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), "[приховано]");
        }
        return safe.replace(/https?:\/\/\S+/gi, "[URL]")
            .replace(/[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/gu, "[email]")
            .replace(/\+?\d[\d ()-]{7,}\d/g, "[номер]")
            .replace(/\b[A-Za-z0-9_-]{35,}\b/g, "[token]").slice(0, 300);
    };
    const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none"
            && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const describe = (node, diagnostic = false) => {
        const rect = node.getBoundingClientRect();
        const shown = visible(node);
        const disabled = Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"
            || node.closest("[inert]"));
        const inViewport = rect.bottom > 0 && rect.right > 0
            && rect.top < innerHeight && rect.left < innerWidth;
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const top = shown && inViewport ? document.elementFromPoint(x, y) : null;
        const inForm = Boolean(node.closest('[role="dialog"], [role="alertdialog"]')
            || (aboutContext && node.closest("section")));
        return {
            tag: node.tagName.toLowerCase(), role: node.getAttribute("role"),
            label: text(node.getAttribute("aria-label") ?? node.labels?.[0]?.innerText, inForm),
            section: text(node.closest("section")?.querySelector("h1,h2,h3,[role=heading]")?.innerText),
            text: /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable
                ? "[поле]" : text(node.innerText, inForm),
            type: /^(INPUT|BUTTON)$/.test(node.tagName) ? node.getAttribute("type") : null,
            visible: shown, enabled: shown && !disabled, inViewport,
            covered: Boolean(top && top !== node && !node.contains(top) && !top.contains(node)),
            blocker: top && top !== node && !node.contains(top)
                ? { tag: top.tagName.toLowerCase(), role: top.getAttribute("role") } : null,
            ...(diagnostic ? { diagnostics: {
                width: Math.round(rect.width), height: Math.round(rect.height),
                display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility,
                opacity: getComputedStyle(node).opacity,
                classes: [...(node.classList ?? [])].filter((value) => /^x[a-z0-9]{1,20}$/.test(value)).slice(0, 12),
            } } : {}),
        };
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    const roots = dialogs.length ? dialogs : [...document.querySelectorAll('main, [role="main"]')].filter(visible).slice(0, 1);
    if (!roots.length && document.body) roots.push(document.body);
    const interactive = 'h1, h2, h3, [role="heading"], button, [role="button"], input, textarea, select, [role="combobox"], [role="option"], [role="alert"], [contenteditable="true"]';
    const nodes = [];
    const seen = new Set();
    outer: for (const root of roots) {
        for (const node of root.querySelectorAll(interactive)) {
            if (seen.has(node) || !visible(node)) continue;
            seen.add(node);
            nodes.push(node);
            if (nodes.length > maxNodes) break outer;
        }
    }
    const elements = nodes.slice(0, maxNodes).map((node, index) => ({
        id: index + 1,
        container: dialogs.indexOf(node.closest('[role="dialog"], [role="alertdialog"]')),
        ...describe(node),
    }));
    let target = null;
    if (selector) {
        try {
            const matches = [...document.querySelectorAll(selector)];
            target = {
                total: matches.length,
                visible: matches.filter(visible).length,
                candidates: matches.slice(0, 15).map((node) => describe(node, true)),
            };
        } catch { target = { invalidSelector: true }; }
    }
    return {
        readyState: document.readyState,
        loading: roots.some((root) => root.matches('[aria-busy="true"]')
            || [...root.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)),
        dialogs: dialogs.map((dialog) => ({
            role: dialog.getAttribute("role"), label: text(dialog.getAttribute("aria-label"), true),
            title: text(dialog.querySelector('h1,h2,h3,[role="heading"]')?.innerText, true),
            text: text(dialog.innerText, true),
        })),
        elements, target, truncated: nodes.length > maxNodes,
    };
}

// Маски накладаються лише на час знімка та прибираються у finally на стороні Node.js.
export function maskTraceScreenshot({ token, uiTexts = [], remove = false }) {
    if (remove) {
        document.querySelectorAll(`[data-adsbot-trace-mask="${token}"]`).forEach((node) => node.remove());
        return;
    }
    const known = new Set(uiTexts.map((value) => String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase()));
    const marker = document.createElement("div");
    marker.setAttribute("data-adsbot-trace-mask", token);
    document.documentElement.append(marker);
    const cover = (rect) => {
        if (!rect.width || !rect.height) return;
        const mask = document.createElement("div");
        mask.setAttribute("data-adsbot-trace-mask", token);
        mask.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#444;z-index:2147483647;pointer-events:none;`;
        document.documentElement.append(mask);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const rects = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('script,style,[data-adsbot-trace-mask]')) continue;
        const value = String(node.textContent).replace(/\s+/g, " ").trim();
        if (value && !known.has(value.toLocaleLowerCase())) {
            const range = document.createRange();
            range.selectNodeContents(node);
            rects.push(...range.getClientRects());
        }
    }
    for (const node of document.querySelectorAll('input,textarea,select,[contenteditable="true"],img,svg,canvas,video,iframe,object,embed')) {
        rects.push(node.getBoundingClientRect());
    }
    // Фонові картинки можуть містити фото профілю або інші особисті дані.
    for (const node of document.body.querySelectorAll("*")) {
        if (getComputedStyle(node).backgroundImage !== "none") rects.push(node.getBoundingClientRect());
    }
    rects.forEach(cover);
}
