import { setTimeout as sleep } from "node:timers/promises";
import { humanClickElement, moveMouseToSafeScrollArea } from "../browser/pointer.js";
import { humanScrollToElement } from "../browser/scroll.js";
import inspectPostComments from "./inspectPostComments.js";
import setCommentReaction from "./setCommentReaction.js";
import { farmPostSelector, farmTexts, findFarmButton } from "../selectors/farming.js";

export function shuffleFarmItems(items, random = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export async function farmPause(config, { signal, random = Math.random } = {}) {
    const milliseconds = Math.round((config.minSeconds + random() * (config.maxSeconds - config.minSeconds)) * 1000);
    await sleep(milliseconds, undefined, { signal });
}

async function buttonHandle(page, labels, rootSelector = '[role="main"]') {
    const handle = await page.evaluateHandle(findFarmButton, rootSelector, labels);
    const element = handle.asElement();
    if (!element) await handle.dispose();
    return element;
}

async function clickFreshButton(page, labels, { timeout, signal, rootSelector } = {}) {
    signal?.throwIfAborted();
    await page.waitForFunction(findFarmButton, { timeout }, rootSelector ?? '[role="main"]', labels);
    await sleep(350, undefined, { signal });
    const button = await buttonHandle(page, labels, rootSelector);
    if (!button) throw new Error("Кнопка змінилася перед кліком");
    try {
        if (await button.evaluate((element) => element.getAttribute("aria-pressed") === "true")) return false;
        await humanClickElement(page, button, { beforeDelay: [200, 500] });
        return true;
    }
    finally { await button.dispose(); }
}

export async function joinFarmGroup(page, { signal, timeout = 60000 } = {}) {
    const texts = farmTexts();
    for (const [key, status] of [["joined", "already_joined"], ["pending", "pending"]]) {
        const existing = await buttonHandle(page, texts[key]);
        if (existing) { await existing.dispose(); return { status, attempted: false }; }
    }
    const join = await buttonHandle(page, texts.join);
    if (!join) return { status: "skipped", reason: "Кнопку вступу не знайдено" };
    await join.dispose();
    await clickFreshButton(page, texts.join, { timeout, signal });
    try {
        await page.waitForFunction(findFarmButton, { timeout }, '[role="main"]', [...texts.joined, ...texts.pending]);
        await sleep(350, undefined, { signal });
    } catch (error) {
        signal?.throwIfAborted();
        return { status: "unknown", attempted: true, reason: "Вступ не підтверджено; можлива анкета або недоступність групи" };
    }
    const joined = await buttonHandle(page, texts.joined);
    if (joined) { await joined.dispose(); return { status: "joined", attempted: true }; }
    return { status: "pending", attempted: true };
}

async function readFeed(page, count, config, context, onPost = async () => {}) {
    const seen = new Set();
    let visited = 0;
    for (let attempt = 0; attempt < Math.max(3, count * 3) && visited < count; attempt++) {
        context.signal.throwIfAborted();
        const cards = await page.$$(farmPostSelector);
        let found = false;
        try {
            for (const card of cards) {
                if (visited >= count) break;
                context.signal.throwIfAborted();
                const info = await card.evaluate((element) => {
                    if (element.parentElement?.closest('[role="article"]')) return null;
                    const link = [...element.querySelectorAll('a[href]')].find((a) => /\/posts\/|\/permalink\/|story_fbid=|\/videos\/|\/photo\/?\?fbid=/.test(a.href) && !/comment_id=/.test(a.href));
                    if (!link) return null;
                    const url = new URL(link.href);
                    if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) return null;
                    for (const key of [...url.searchParams.keys()]) if (!["story_fbid", "id", "fbid"].includes(key)) url.searchParams.delete(key);
                    return { url: url.href };
                });
                if (!info || seen.has(info.url)) continue;
                seen.add(info.url); found = true;
                await humanScrollToElement(page, card);
                await moveMouseToSafeScrollArea(page, card);
                await farmPause(config, context);
                visited++;
                await context.log({ action: "read_post", status: "completed", index: visited });
                await onPost(info, card);
                if (visited < count && context.random() * 100 < (config.upPercent ?? 0)) {
                    await page.mouse.wheel({ deltaY: -150 - context.random() * 250 });
                    await sleep(600, undefined, { signal: context.signal });
                }
            }
        } finally { await Promise.all(cards.map((card) => card.dispose().catch(() => {}))); }
        if (visited < count) {
            await page.mouse.wheel({ deltaY: !found || context.random() * 100 >= (config.upPercent ?? 0) ? 600 + context.random() * 500 : -250 });
            await sleep(1200, undefined, { signal: context.signal });
        }
    }
    if (visited < count) await context.log({ action: "read_feed", status: "skipped", reason: "Недостатньо доступних постів", visited, requested: count });
    return visited;
}

async function withPost(page, url, context, operation) {
    const tab = await page.browser().newPage();
    try {
        context.signal.throwIfAborted();
        await tab.goto(url, { waitUntil: "domcontentloaded", timeout: context.timeout });
        await tab.waitForSelector('[role="main"]', { timeout: context.timeout });
        context.signal.throwIfAborted();
        // Позначаємо лише корінь відкритого поста, щоб не реагувати на інший пост чи коментар.
        const rootFound = await tab.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"][aria-modal="true"][aria-labelledby]');
            let root = dialog;
            if (!root) {
                const story = document.querySelector('[role="main"] [data-ad-rendering-role="story_message"]');
                root = story;
                while (root && !root.querySelector('[data-ad-rendering-role="comment_button"]')) root = root.parentElement;
            }
            if (!root || root === document.body || root === document.documentElement || root.matches('[role="main"], [role="feed"]')) return false;
            root.setAttribute("data-farm-post", "true");
            return true;
        });
        if (!rootFound) throw new Error("Корінь відкритого поста не знайдено");
        await operation(tab);
    } finally { await tab.close().catch(() => {}); }
}

export default async function runFarmActions(page, { settings, pool, signal, log = async () => {}, random = Math.random, timeout = 60000 }) {
    const context = { signal, random, log, timeout };
    const actions = settings.actions;
    const selectedGroups = shuffleFarmItems(pool.filter((group) => group.enabled), random);
    const jobs = [];
    let postLikes = 0;
    let commentLikes = 0;
    const texts = farmTexts();
    const readConfig = actions.feed;
    const home = async () => {
        signal.throwIfAborted();
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout });
        await page.waitForSelector('[role="feed"], [role="main"] [aria-posinset]', { timeout });
    };
    const like = async (tab) => {
        const existing = await buttonHandle(tab, texts.liked, '[data-farm-post]');
        if (existing) { await existing.dispose(); await log({ action: "like_post", status: "already_reacted" }); return; }
        const clicked = await clickFreshButton(tab, texts.like, { timeout, signal, rootSelector: '[data-farm-post]' });
        if (!clicked) { await log({ action: "like_post", status: "already_reacted" }); return; }
        await tab.waitForFunction(findFarmButton, { timeout }, '[data-farm-post]', texts.liked);
        await sleep(350, undefined, { signal });
        postLikes++;
        await log({ action: "like_post", status: "completed" });
    };
    const maybeLike = async (info) => {
        if (actions.likePosts.enabled && postLikes < actions.likePosts.max && random() * 100 < actions.likePosts.percent) {
            await withPost(page, info.url, context, like);
        }
    };
    if (actions.feed.enabled) jobs.push({ key: "feed", run: async () => {
        await home(); await readFeed(page, actions.feed.count, readConfig, context, maybeLike);
    } });
    if (actions.openPosts.enabled) jobs.push({ key: "openPosts", run: async () => {
        await home(); await readFeed(page, actions.openPosts.count, readConfig, context, async (info) => {
            await withPost(page, info.url, context, async (tab) => {
                await farmPause(actions.openPosts, context);
                await log({ action: "open_post", status: "completed" });
                if (actions.likePosts.enabled && postLikes < actions.likePosts.max && random() * 100 < actions.likePosts.percent) await like(tab);
            });
        });
    } });
    if (actions.likePosts.enabled && !actions.feed.enabled && !actions.openPosts.enabled && !actions.groups.enabled) jobs.push({ key: "likePosts", run: async () => {
        if (!actions.likePosts.percent || !actions.likePosts.max) return;
        await home(); await readFeed(page, readConfig.count, readConfig, context, maybeLike);
    } });
    if (actions.likeComments.enabled) jobs.push({ key: "likeComments", run: async () => {
        if (!actions.likeComments.percent || !actions.likeComments.max) return;
        await home();
        await readFeed(page, actions.likeComments.posts, readConfig, context, async (info) => {
            if (commentLikes >= actions.likeComments.max) return;
            await withPost(page, info.url, context, async (tab) => {
                const comments = await inspectPostComments(tab);
                for (const comment of shuffleFarmItems(comments.filter((item) => item.id), random)) {
                    signal.throwIfAborted();
                    if (commentLikes >= actions.likeComments.max) break;
                    if (random() * 100 >= actions.likeComments.percent) continue;
                    const result = await setCommentReaction(tab, { commentId: comment.id, reaction: "like" });
                    if (result.status === "APPLIED") commentLikes++;
                    await log({ action: "like_comment", status: result.status, reason: result.reason });
                }
            });
        });
    } });
    if (actions.groups.enabled) jobs.push({ key: "groups", run: async () => {
        for (const group of selectedGroups.slice(0, actions.groups.count)) {
            signal.throwIfAborted();
            try {
                await page.goto(group.url, { waitUntil: "domcontentloaded", timeout });
                await page.waitForSelector(farmPostSelector, { timeout });
                await readFeed(page, actions.groups.posts, actions.groups, context, maybeLike);
            } catch (error) {
                signal.throwIfAborted();
                await log({ action: "group_feed", status: "skipped", groupId: group.id, reason: "Пости групи недоступні" });
            }
        }
    } });
    if (actions.joinGroups.enabled) jobs.push({ key: "joinGroups", run: async () => {
        let attempted = 0;
        for (const group of selectedGroups) {
            signal.throwIfAborted();
            if (attempted >= actions.joinGroups.max) break;
            try {
                await page.goto(group.url, { waitUntil: "domcontentloaded", timeout });
                await page.waitForSelector('[role="main"]', { timeout });
                const result = await joinFarmGroup(page, context);
                if (result.attempted) attempted++;
                await log({ action: "join_group", groupId: group.id, ...result });
            } catch (error) {
                signal.throwIfAborted();
                await log({ action: "join_group", groupId: group.id, status: "skipped", reason: "Група недоступна" });
            }
        }
    } });
    for (const job of shuffleFarmItems(jobs, random)) {
        signal.throwIfAborted();
        try { await job.run(); await log({ action: job.key, status: "completed" }); }
        catch (error) { signal.throwIfAborted(); await log({ action: job.key, status: "failed", reason: error.message }); }
    }
}
