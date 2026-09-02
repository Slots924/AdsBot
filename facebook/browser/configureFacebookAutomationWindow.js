export const facebookAutomationWindowSize = Object.freeze({
    width: 1280,
    height: 1440,
    deviceScaleFactor: 1,
});


export default async function configureFacebookAutomationWindow(
    page,
    { browserMode = "visible" } = {}
) {
    const isHeadless = browserMode === "headless";

    if (isHeadless) {
        if (typeof page?.setViewport !== "function") {
            return { applied: false, mode: "headless" };
        }

        await page.setViewport(facebookAutomationWindowSize);
        return {
            applied: true,
            mode: "headless",
            viewport: facebookAutomationWindowSize,
        };
    }

    if (typeof page?.target !== "function") {
        return { applied: false, mode: "visible" };
    }

    const client = await page.target().createCDPSession();

    try {
        const { windowId } = await client.send("Browser.getWindowForTarget");
        await client.send("Browser.setWindowBounds", {
            windowId,
            bounds: { windowState: "normal" },
        });
        await client.send("Browser.setWindowBounds", {
            windowId,
            bounds: {
                width: facebookAutomationWindowSize.width,
                height: facebookAutomationWindowSize.height,
            },
        });
        const { bounds } = await client.send("Browser.getWindowBounds", {
            windowId,
        });

        return { applied: true, mode: "visible", bounds };
    } finally {
        await client.detach();
    }
}
