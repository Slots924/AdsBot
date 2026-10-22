import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FarmAccountsTab from "../tabs/FarmAccountsTab.jsx";
import FarmAddModal from "../components/FarmAddModal.jsx";
import { normalizeFarmSettings } from "../../../services/farming/farmSettings.js";
import { findFarmButton, farmTexts } from "../../../facebook/selectors/farming.js";
import { facebookTranslations, supportedFacebookLanguages } from "../../../facebook/i18n/index.js";
import runFarmActions, { joinFarmGroup } from "../../../facebook/actions/runFarmActions.js";
import { humanClickElement } from "../../../facebook/browser/pointer.js";

vi.mock("../../../facebook/browser/pointer.js", () => ({ humanClickElement: vi.fn(), moveMouseToSafeScrollArea: vi.fn() }));
vi.mock("../../../facebook/browser/scroll.js", () => ({ humanScrollToElement: vi.fn() }));
vi.mock("../../../facebook/actions/inspectPostComments.js", () => ({ default: vi.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]) }));
vi.mock("../../../facebook/actions/setCommentReaction.js", () => ({ default: vi.fn().mockResolvedValue({ status: "APPLIED" }) }));

const ok = (data) => ({ ok: true, data });
let snapshot;
beforeEach(() => {
    const totals = { setupUiCount: 1, setupApiCount: 0, commentTaskCount: 2, reactionTaskCount: 3, farmSessionCount: 0, farmTimeMs: 0 };
    snapshot = { groups: [{ id: "g1", name: "Група A", notes: "Абзац 1\n\nАбзац 2", count: 2, banned: 0, bannedPercent: 0, totals, averages: totals }],
        settings: normalizeFarmSettings(), pool: [], history: { runs: [], memberships: [] },
        members: [1, 2].map((n) => ({ profileNo: String(n), profileId: `id-${n}`, name: `Акаунт ${n}`, outcomes: {}, farmTimeMs: 0, farmSessionCount: 0 })) };
    window.adsBot = {
        getFarmSnapshot: vi.fn().mockImplementation(async () => ok(snapshot)),
        saveFarmGroup: vi.fn().mockResolvedValue(ok({ id: "new", name: "Нова" })),
        assignFarmProfiles: vi.fn().mockResolvedValue(ok({ assigned: 2 })),
        runFarm: vi.fn().mockResolvedValue(ok({ taskId: "task" })),
        checkCommentAccounts: vi.fn().mockResolvedValue(ok({ taskId: "health" })),
        moveAdsPowerProfiles: vi.fn().mockResolvedValue(ok({ moved: 2 })),
        renameAdsPowerProfile: vi.fn().mockResolvedValue(ok({})),
        saveFarmPool: vi.fn().mockResolvedValue(ok([])),
        saveFarmSettings: vi.fn().mockImplementation(async (settings) => ok(settings)),
    };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 30, top: 0, left: 0 });
    vi.mocked(humanClickElement).mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("додає профілі в нову незалежну групу", async () => {
    render(<FarmAddModal profiles={snapshot.members} onClose={vi.fn()} onAdded={vi.fn()} />);
    await screen.findByRole("option", { name: "Група A" });
    fireEvent.change(screen.getByLabelText("Або нова група"), { target: { value: "Нова" } });
    fireEvent.click(screen.getByRole("button", { name: "Додати" }));
    await waitFor(() => expect(window.adsBot.assignFarmProfiles).toHaveBeenCalledWith("new", ["1", "2"]));
});

it("зберігає абзаци нотаток, масово переносить AdsPower-групу та запускає тільки вибрані дії", async () => {
    render(<FarmAccountsTab groups={[{ groupId: "ads", groupName: "Ads група" }]} />);
    await screen.findByText("Акаунт 1");
    fireEvent.change(screen.getByLabelText("Помітки"), { target: { value: "Новий\n\nДругий" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти групу" }));
    await waitFor(() => expect(window.adsBot.saveFarmGroup).toHaveBeenCalledWith({ id: "g1", name: "Група A", notes: "Новий\n\nДругий" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Зберегти групу" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Вибрати всі акаунти"));
    fireEvent.change(screen.getByLabelText("Нова група AdsPower"), { target: { value: "ads" } });
    fireEvent.click(screen.getByRole("button", { name: "Змінити AdsPower-групу" }));
    await waitFor(() => expect(window.adsBot.moveAdsPowerProfiles).toHaveBeenCalledWith(["id-1", "id-2"], "ads"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Фарм вибраних (2)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Фарм вибраних (2)" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Запустити" })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Перегляд домашньої стрічки"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Запустити" }));
    await waitFor(() => expect(window.adsBot.runFarm).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g1", profileNos: ["1", "2"], actions: expect.objectContaining({ feed: expect.objectContaining({ enabled: true }), likePosts: expect.objectContaining({ enabled: false }) }) })));
});

it("перейменовує AdsPower-профіль та зберігає спільні налаштування", async () => {
    render(<FarmAccountsTab />);
    fireEvent.click(await screen.findByText("Акаунт 1"));
    fireEvent.change(screen.getByLabelText("Нова назва"), { target: { value: "Інша назва" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.adsBot.renameAdsPowerProfile).toHaveBeenCalledWith("id-1", "Інша назва"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Налаштування" }));
    fireEvent.change(screen.getByLabelText("Воркери"), { target: { value: "2" } });
    expect(screen.getByLabelText("Вимкнути картинки")).not.toBeChecked();
    expect(screen.getByLabelText("Безголовий режим")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Зберегти налаштування" }));
    await waitFor(() => expect(window.adsBot.saveFarmSettings).toHaveBeenCalledWith(expect.objectContaining({ workers: 2, timeoutSeconds: 500 })));
});

it("вилучає вибрані акаунти та ставить перевірку в наявну чергу", async () => {
    render(<FarmAccountsTab />);
    await screen.findByText("Акаунт 1");
    fireEvent.click(screen.getByLabelText("Вибрати 1"));
    fireEvent.click(screen.getByRole("button", { name: "Перевірити акаунти" }));
    await waitFor(() => expect(window.adsBot.checkCommentAccounts).toHaveBeenCalledWith({ profileNos: ["1"] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Вилучити з групи" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Вилучити з групи" }));
    await waitFor(() => expect(window.adsBot.assignFarmProfiles).toHaveBeenCalledWith(null, ["1"]));
});

it.each(supportedFacebookLanguages)("селектори %s підтримують інший регістр, відхиляють сторонній текст і коментарі", (language) => {
    const label = facebookTranslations[language].farming.like[0];
    document.body.innerHTML = `<main role="main" data-farm-post><button aria-label="${label.toUpperCase()}"></button><div role="article"><button>Like</button></div></main>`;
    expect(findFarmButton('[role="main"]', farmTexts().like)).toBeTruthy();
    document.querySelector("main > button").remove();
    expect(findFarmButton('[role="main"]', farmTexts().like)).toBeNull();
    document.body.innerHTML = '<main role="main"><button>Unrelated</button></main>';
    expect(findFarmButton('[role="main"]', farmTexts().like)).toBeNull();
});

function handle(element) { return { asElement: () => element ? handle(element) : null, evaluate: async (fn, ...args) => fn(element, ...args), dispose: async () => {} }; }
function domPage() {
    return {
        evaluateHandle: async (fn, ...args) => handle(fn(...args)),
        evaluate: async (fn, ...args) => fn(...args),
        waitForFunction: async (fn, _options, ...args) => { if (!fn(...args)) throw new Error("DOM state missing"); },
        waitForSelector: async () => {},
    };
}

it.each(["Joined", "Cancel request"])("не повторює вступ у стані %s", async (label) => {
    document.body.innerHTML = `<main role="main"><button>${label}</button></main>`;
    const result = await joinFarmGroup(domPage(), { signal: new AbortController().signal });
    expect(result.status).toBe(label === "Joined" ? "already_joined" : "pending");
    expect(humanClickElement).not.toHaveBeenCalled();
});

it("фіксує заявку на вступ, не заповнює анкету та пропускає недоступну групу", async () => {
    document.body.innerHTML = '<main role="main"><button>JOIN GROUP</button></main>';
    vi.mocked(humanClickElement).mockImplementation(async () => { document.querySelector("button").textContent = "Cancel request"; });
    expect((await joinFarmGroup(domPage(), { signal: new AbortController().signal })).status).toBe("pending");
    expect(humanClickElement).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '<main role="main"><p>Недоступно</p></main>';
    expect((await joinFarmGroup(domPage(), { signal: new AbortController().signal })).status).toBe("skipped");
    document.body.innerHTML = '<main role="main"><button>Join group</button></main>';
    vi.mocked(humanClickElement).mockImplementation(async () => { document.querySelector("button").textContent = "Answer questions"; });
    expect((await joinFarmGroup(domPage(), { signal: new AbortController().signal })).status).toBe("unknown");
});

it("ліміт реакцій дотримується, вже встановлений лайк не знімається", async () => {
    const settings = normalizeFarmSettings({ actions: { openPosts: { enabled: true, count: 3, minSeconds: 0, maxSeconds: 0 }, feed: { minSeconds: 0, maxSeconds: 0 }, likePosts: { enabled: true, percent: 100, max: 1 } } });
    const events = [];
    let post = 0;
    const home = '<main role="main"><div role="feed">' + [1, 2, 3].map((id) => `<div role="article"><a href="https://www.facebook.com/example/posts/${id}">Пост</a></div>`).join("") + '</div></main>';
    const page = { ...domPage(), goto: async () => { document.body.innerHTML = home; },
        $$: async (selector) => [...document.querySelectorAll(selector)].map(handle), mouse: { wheel: vi.fn() },
        browser: () => ({ newPage: async () => ({ ...domPage(), goto: async () => {
            post++; document.body.innerHTML = `<main role="main"><div role="article"><div data-ad-rendering-role="story_message">Пост</div><div data-ad-rendering-role="comment_button"></div><button>${post === 1 ? "Remove Like" : "Like"}</button></div></main>`;
        }, close: async () => { document.body.innerHTML = home; } }) }) };
    vi.mocked(humanClickElement).mockImplementation(async () => { document.querySelector("button").textContent = "Remove Like"; });
    await runFarmActions(page, { settings, pool: [], signal: new AbortController().signal, random: () => 0, log: async (event) => events.push(event) });
    expect(events.filter((event) => event.action === "open_post")).toHaveLength(3);
    expect(events.filter((event) => event.status === "already_reacted")).toHaveLength(1);
    expect(humanClickElement).toHaveBeenCalledTimes(1);
});

it("нульовий відсоток лайків не викликає навігацію чи кліки", async () => {
    const page = { goto: vi.fn() };
    await runFarmActions(page, { settings: normalizeFarmSettings({ actions: { likePosts: { enabled: true, percent: 0 } } }),
        pool: [], signal: new AbortController().signal });
    expect(page.goto).not.toHaveBeenCalled();
    expect(humanClickElement).not.toHaveBeenCalled();
});

it("очікування старої заявки не витрачає ліміт нових вступів", async () => {
    const events = [];
    const page = { ...domPage(), goto: vi.fn(async (url) => {
        document.body.innerHTML = `<main role="main"><button>${url.endsWith("b") ? "Cancel request" : "Join group"}</button></main>`;
    }) };
    vi.mocked(humanClickElement).mockImplementation(async () => { document.querySelector("button").textContent = "Joined"; });
    await runFarmActions(page, { settings: normalizeFarmSettings({ actions: { joinGroups: { enabled: true, max: 1 } } }),
        pool: ["a", "b", "c"].map((id) => ({ id, enabled: true, url: `https://www.facebook.com/groups/${id}` })),
        signal: new AbortController().signal, random: () => 0, log: async (event) => events.push(event) });
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(humanClickElement).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.action === "join_group").map((event) => event.status)).toEqual(["pending", "joined"]);
});
