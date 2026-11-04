import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonalAccountModal from "../components/PersonalAccountModal.jsx";
import PersonalFpHub from "../components/PersonalFpHub.jsx";
import FavoriteGroupSelect from "../components/FavoriteGroupSelect.jsx";
import CommentAccountsTab from "../tabs/CommentAccountsTab.jsx";
import personalAutouploadApi from "../lib/personalAutouploadApi.js";
import { unwrap } from "../lib/api.js";

const ok = data => Promise.resolve({ ok: true, data });
const profile = { profileId: "p1", profileNo: "2559", name: "Test profile", groupId: "old", tags: [] };
const session = { id: "http-test", actorId: "123", profile, overview: { hasAccessToken: true, fanPages: [], adAccounts: [] } };

beforeEach(() => {
    const storage = new Map();
    vi.stubGlobal("localStorage", { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) });
    window.adsBot = {
        getCreditCards: vi.fn(() => ok([])), getPersonalSmsPoolDashboard: vi.fn(() => ok({})),
        getNextPersonalApiName: vi.fn(() => ok("P065")),
        personalAutoupload: vi.fn(action => ok(action === "start" ? session : action === "api.create" ? { account: { name: "P065" }, adsPowerProfileName: "P065", groupId: "farm" } : {})),
        startPersonalAccountSession: vi.fn(), getAutoupload: vi.fn(() => ok({ groups: [], profiles: [] })),
    };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Статуси прив'язки карти HTTP", () => {
    it("передає ліміт як відмову GUI зі статусом і кодом Meta", async () => {
        const api = personalAutouploadApi({ personalAutoupload: vi.fn(() => ok({
            success: false, status: "CARD_ACCOUNT_LIMIT_REACHED", graphCode: 4992003,
            error: "Перевищено ліміт рекламних акаунтів для цієї карти", data: { cardSaved: false },
        })) });
        await expect(unwrap(api.addPersonalCreditCard("http-test", {}))).rejects.toMatchObject({
            code: "CARD_ACCOUNT_LIMIT_REACHED", graphCode: 4992003, status: "CARD_ACCOUNT_LIMIT_REACHED",
        });
    });
    it("зберігає ID вже збереженої карти, коли потрібне підтвердження", async () => {
        const api = personalAutouploadApi({ personalAutoupload: vi.fn(() => ok({
            success: false, status: "AUTHENTICATION_REQUIRED", error: "Потрібна перевірка",
            data: { paymentMethodId: "321", cardSaved: true },
        })) });
        await expect(unwrap(api.addPersonalCreditCard("http-test", {}))).rejects.toMatchObject({
            code: "AUTHENTICATION_REQUIRED", paymentMethodId: "321", data: { cardSaved: true },
        });
    });
    it("передає підтверджений успіх без зміни результату", async () => {
        const api = personalAutouploadApi({ personalAutoupload: vi.fn(() => ok({ success: true, status: "ADDED", paymentMethodId: "321" })) });
        await expect(unwrap(api.addPersonalCreditCard("http-test", {}))).resolves.toMatchObject({ success: true, status: "ADDED" });
    });
});

describe("Персональні автоаплоад", () => {
    it("приймає номер без вибраного акаунта й запускає тільки HTTP-сесію", async () => {
        render(<PersonalAccountModal mode="http" profile={null} onClose={vi.fn()} />);
        fireEvent.change(screen.getByLabelText("Номер AdsPower-профілю"), { target: { value: "2559" } });
        fireEvent.click(screen.getByRole("button", { name: "Запустити і перевірити" }));
        await waitFor(() => expect(screen.getByText("Test profile")).toBeInTheDocument());
        expect(window.adsBot.personalAutoupload).toHaveBeenCalledWith("start", { profileNo: "2559" });
        expect(window.adsBot.startPersonalAccountSession).not.toHaveBeenCalled();
        expect(screen.queryByText("Access token")).not.toBeInTheDocument();
        expect(screen.queryByText("Бізнес-інфо")).not.toBeInTheDocument();
        expect(window.adsBot.getAutoupload).not.toHaveBeenCalled();
    });
    it("ручне відкриття є окремою дією, згортання зберігає введений номер", async () => {
        render(<PersonalAccountModal mode="http" profile={profile} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Відкрити профіль зі збереженими вкладками" }));
        await waitFor(() => expect(window.adsBot.personalAutoupload).toHaveBeenCalledWith("open", { profileNo: "2559" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Згорнути" })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "Згорнути" }));
        fireEvent.pointerDown(screen.getByText("Автоаплоад №2559"), { clientX: 0, clientY: 0 });
        fireEvent.pointerUp(screen.getByText("Автоаплоад №2559"));
        expect(screen.getByLabelText("Номер AdsPower-профілю")).toHaveValue("2559");
    });
    it("підставляє P065 і обрану групу, після створення показує підтвердження", async () => {
        render(<PersonalAccountModal mode="http" profile={profile} groups={[{ groupId: "farm", groupName: "FB Farm №2" }]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Запустити і перевірити" }));
        await waitFor(() => expect(screen.getByText("HTTP-сесію підготовлено")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: /API-профіль/ }));
        await waitFor(() => expect(screen.getByDisplayValue("P065")).toBeInTheDocument());
        await waitFor(() => expect(screen.getByLabelText("Група після створення API-клієнта")).toHaveTextContent("FB Farm №2"));
        fireEvent.click(screen.getByRole("button", { name: "Створити API-профіль" }));
        await waitFor(() => expect(screen.getByText("API-клієнт створений · P065")).toBeInTheDocument());
        expect(window.adsBot.personalAutoupload).toHaveBeenCalledWith("api.create", { sessionId: "http-test", name: "P065", autoName: true, cardId: "", groupId: "farm" });
        expect(screen.getByRole("button", { name: "Створити API-профіль" })).toBeDisabled();
    });
});

it("FP HUB поширює фанки послідовно з реальною затримкою", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.adsBot.getAutoupload = vi.fn(() => ok({ groups: [{ id: "hubs", name: "FP Hubs" }], profiles: [{ profileId: "hub", profileNo: "10", name: "Hub", groupId: "hubs" }] }));
    window.adsBot.getAutouploadFanPages = vi.fn(() => ok({ success: true, pages: [{ additionalProfileId: "1", name: "One" }, { additionalProfileId: "2", name: "Two" }] }));
    window.adsBot.shareAutouploadFanPage = vi.fn(() => ok({ success: true, message: "Запрошення відправлено" }));
    render(<PersonalFpHub targetUserId="123" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByLabelText("Профіль FP HUB"));
    fireEvent.click(screen.getByRole("button", { name: /Hub\s*№10/ }));
    fireEvent.click(screen.getByRole("button", { name: "Список фанок" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Пошарити всі" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(2);
    expect(window.adsBot.shareAutouploadFanPage.mock.calls[1][0]).toEqual({ ids: ["hub"], additionalProfileId: "2", targetUserId: "123" });
});

async function openHub() {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.adsBot.getAutoupload = vi.fn(() => ok({ groups: [{ id: "hubs", name: "FP Hubs" }], profiles: [{ profileId: "hub", profileNo: "10", name: "Hub", groupId: "hubs" }] }));
    window.adsBot.getAutouploadFanPages = vi.fn(() => ok({ success: true, pages: [{ additionalProfileId: "1", name: "One" }, { additionalProfileId: "2", name: "Two" }] }));
    render(<PersonalFpHub targetUserId="123" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByLabelText("Профіль FP HUB"));
    fireEvent.click(screen.getByRole("button", { name: /Hub\s*№10/ }));
    fireEvent.click(screen.getByRole("button", { name: "Список фанок" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

it("зупинка FP HUB під час затримки не надсилає наступну фанку", async () => {
    window.adsBot.shareAutouploadFanPage = vi.fn(() => ok({ success: true, message: "Запрошення відправлено" }));
    await openHub();
    fireEvent.click(screen.getByRole("button", { name: "Пошарити всі" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Зупинити" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Чергу зупинено");
});

it("FP HUB запитує відсутній пароль і продовжує чергу після введення", async () => {
    window.adsBot.shareAutouploadFanPage = vi.fn()
        .mockImplementationOnce(() => ok({ success: false, code: "FACEBOOK_PASSWORD_REQUIRED" }))
        .mockImplementation(() => ok({ success: true, message: "Запрошення надіслано" }));
    await openHub();
    fireEvent.click(screen.getByRole("button", { name: "Пошарити всі" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("dialog", { name: "Не вказано пароль Facebook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторити з цим паролем" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Пароль Facebook"), { target: { value: "manual-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Повторити з цим паролем" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenNthCalledWith(2, { ids: ["hub"], additionalProfileId: "1", targetUserId: "123", password: "manual-test-password" });
    expect(screen.queryByLabelText("Пароль Facebook")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(3);
});

it("скасування введення пароля FP HUB не повторює запит і зупиняє чергу", async () => {
    window.adsBot.shareAutouploadFanPage = vi.fn(() => ok({ success: false, code: "FACEBOOK_PASSWORD_REQUIRED" }));
    await openHub();
    fireEvent.click(screen.getByRole("button", { name: "Пошарити всі" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText("Пароль Facebook"), { target: { value: "discarded-test-password" } });
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("скасовано");
});

it("невизначений результат FP HUB припиняє чергу й блокує повтор цієї фанки", async () => {
    window.adsBot.shareAutouploadFanPage = vi.fn(() => Promise.resolve({ ok: false, error: { message: "Перевірте результат", outcomeUnknown: true } }));
    await openHub();
    fireEvent.click(screen.getByRole("button", { name: "Пошарити всі" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Перевірте стан" })).toBeDisabled();
});

it("зірочка зберігає групу за замовчуванням для наступного відкриття", async () => {
    const groups = [{ id: "one", name: "FP Hubs" }, { id: "two", name: "Other hubs" }];
    const onChange = vi.fn();
    const props = { groups, value: "", onChange, storageKey: "test-favorite", defaultName: "FP Hubs", ariaLabel: "Група" };
    const view = render(<FavoriteGroupSelect {...props} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("one"));
    fireEvent.click(screen.getByLabelText("Група"));
    fireEvent.click(screen.getByRole("button", { name: "Обрати групу Other hubs за замовчуванням" }));
    view.unmount();
    onChange.mockClear();
    render(<FavoriteGroupSelect {...props} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("two"));
});

it("кнопка автоаплоадів завжди активна й бере перший вибраний профіль", async () => {
    const profiles = [profile, { ...profile, profileId: "p2", profileNo: "2560", name: "Second profile" }];
    window.adsBot.getAdsPowerGroupProfiles = vi.fn(() => ok(profiles));
    const onOpen = vi.fn();
    const props = { groups: [{ groupId: "group", groupName: "Test group" }], favoriteGroupIds: [],
        onFavoriteGroupIdsChange: vi.fn(), onOpenPersonalAutoupload: onOpen, onError: vi.fn() };
    const view = render(<CommentAccountsTab {...props} />);
    const button = screen.getByRole("button", { name: "Персональні автоаплоад" });
    expect(button).toBeEnabled(); fireEvent.click(button);
    expect(onOpen).toHaveBeenLastCalledWith(null);
    view.rerender(<CommentAccountsTab {...props} leftGroupId="group" leftSelectedIds={["p1", "p2"]} />);
    await waitFor(() => expect(window.adsBot.getAdsPowerGroupProfiles).toHaveBeenCalledWith("group"));
    await waitFor(() => expect(screen.getByText("Test profile")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Персональні автоаплоад" }));
    expect(onOpen).toHaveBeenLastCalledWith(profile);
});
