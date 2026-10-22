import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutouploadTab from "../tabs/AutouploadTab.jsx";
import AutouploadAddModal from "../components/AutouploadAddModal.jsx";

const ok = (data) => Promise.resolve({ ok: true, data });
const state = {
    groups: [{ id: "new", name: "Нові" }, { id: "ready", name: "Готові" }],
    profiles: [{ profileId: "p1", profileNo: "12", name: "Test profile", groupId: "new", status: "login_required", checkedAt: null, message: "Потрібна авторизація" }],
    history: [],
};
beforeEach(() => {
    window.adsBot = {
        getAutoupload: vi.fn(() => ok(structuredClone(state))),
        onAutouploadUpdated: vi.fn(() => () => {}),
        mutateAutoupload: vi.fn(() => ok(structuredClone(state))),
        checkAutouploadSessions: vi.fn(() => ok({ taskId: "task1" })),
        sendAutouploadFriendRequests: vi.fn(() => ok({ taskId: "friend-task" })),
        shareAutouploadAdAccounts: vi.fn(() => ok({ taskId: "share-task" })),
        transferAutouploadPersonalAccounts: vi.fn(() => ok({ taskId: "transfer-task" })),
        controlAutouploadProfile: vi.fn((_profileId, action) => ok({ profileId: "p1", adsPowerOpen: action === "open" })),
    };
});
afterEach(() => { cleanup(); delete window.adsBot; });

describe("Автозаливи", () => {
    it("видалення одного профілю підтверджується, AdsPower початково вимкнений", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Прибрати профіль 12" }));
        expect(screen.getByRole("checkbox", { name: "Також видалити профілі в AdsPower" })).not.toBeChecked();
        fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
        await waitFor(() => expect(window.adsBot.mutateAutoupload).toHaveBeenCalledWith({ action: "remove", ids: ["p1"], groupId: "new", deleteAdsPower: false }));
    });
    it("видалення в AdsPower передає явний вибір користувача", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Прибрати профіль 12" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Також видалити профілі в AdsPower" }));
        fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
        await waitFor(() => expect(window.adsBot.mutateAutoupload).toHaveBeenCalledWith(expect.objectContaining({ deleteAdsPower: true })));
    });
    it("олівець відкриває редагування назви профілю", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Перейменувати профіль 12" }));
        fireEvent.change(screen.getByLabelText("Назва профілю"), { target: { value: "Нова назва" } });
        fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
        await waitFor(() => expect(window.adsBot.mutateAutoupload).toHaveBeenCalledWith({ action: "rename-profile", id: "p1", name: "Нова назва" }));
    });
    it("передача обирає групу та кінга зі списку без вибору окремих РК", async () => {
        const assets = { adAccountsState: "loaded", adAccounts: [] };
        window.adsBot.getAutoupload.mockImplementation(() => ok({ ...state, profiles: [{ ...state.profiles[0], assets }, { profileId: "king", profileNo: "99", name: "King", groupId: "ready", assets }] }));
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Передати персональні РК кінгу" }));
        fireEvent.change(screen.getByLabelText("Група кінга"), { target: { value: "ready" } });
        fireEvent.change(screen.getByLabelText("Профіль кінга"), { target: { value: "king" } });
        fireEvent.click(screen.getByRole("button", { name: "Додати в друзі та передати РК" }));
        await waitFor(() => expect(window.adsBot.transferAutouploadPersonalAccounts).toHaveBeenCalledWith({ ids: ["p1"], targetProfileId: "king" }));
    });
    it("показує точну причину часткового оновлення та мережевий код у деталях", async () => {
        window.adsBot.getAutoupload.mockImplementation(() => ok({ ...state, history: [{ id: "partial", profileId: "p1", profileNo: "12", status: "active", message: "Дані оновлено частково", warnings: [{ scope: "adsManager", stage: "adsManager", status: "network_timeout", code: "PROXY_POOL_EXHAUSTED", networkCode: "ETIMEDOUT", message: "connect ETIMEDOUT [REDACTED]", endpoint: "https://adsmanager.facebook.com/adsmanager/manage/campaigns" }] }] }));
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Деталі" }));
        expect(screen.getByRole("dialog")).toHaveTextContent("Час очікування вичерпано");
        expect(screen.getByRole("dialog")).toHaveTextContent("ETIMEDOUT");
        expect(screen.getByRole("dialog")).toHaveTextContent("adsManager");
        expect(screen.getByRole("dialog")).toHaveTextContent("PROXY_POOL_EXHAUSTED");
    });
    it("шерить лише вибрані персональні РК після явного підтвердження", async () => {
        window.adsBot.getAutoupload.mockImplementation(() => ok({ ...state, profiles: [{ ...state.profiles[0], assets: { adAccounts: [
            { accountId: "101", name: "Особистий", isPersonal: true }, { accountId: "102", name: "Другий", isPersonal: true },
            { accountId: "103", name: "Бізнесовий", isPersonal: false, businessId: "999" }, { accountId: "104", name: "Старі дані" },
        ] } }] }));
        render(<AutouploadTab />);
        expect(screen.getByRole("button", { name: "Пошерити РК" })).toBeDisabled();
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Пошерити РК" }));
        expect(screen.getAllByRole("switch")).toHaveLength(2);
        expect(screen.queryByRole("switch", { name: /103|104/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("switch", { name: "Вибрати РК 101 профілю 12" }));
        fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "456" } });
        expect(screen.getByRole("button", { name: "Надати Admin-доступ" })).toBeDisabled();
        expect(window.adsBot.shareAutouploadAdAccounts).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("checkbox", { name: /Підтверджую надання/ }));
        fireEvent.click(screen.getByRole("button", { name: "Надати Admin-доступ" }));
        await waitFor(() => expect(window.adsBot.shareAutouploadAdAccounts).toHaveBeenCalledWith({ ids: ["p1"], accounts: [{ profileId: "p1", adAccountId: "101" }], targetUserId: "456", confirmed: true }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
    it("зміна отримувача скидає підтвердження, помилка запуску залишається в модальному вікні", async () => {
        window.adsBot.getAutoupload.mockImplementation(() => ok({ ...state, profiles: [{ ...state.profiles[0], assets: { adAccounts: [{ accountId: "101", name: "Особистий", isPersonal: true }] } }] }));
        window.adsBot.shareAutouploadAdAccounts.mockResolvedValue({ ok: false, error: { message: "Сесія застаріла" } });
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Пошерити РК" }));
        fireEvent.click(screen.getByRole("switch"));
        fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "456" } });
        fireEvent.click(screen.getByRole("checkbox", { name: /Підтверджую надання/ }));
        fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "789" } });
        expect(screen.getByRole("checkbox", { name: /Підтверджую надання/ })).not.toBeChecked();
        fireEvent.click(screen.getByRole("checkbox", { name: /Підтверджую надання/ }));
        fireEvent.click(screen.getByRole("button", { name: "Надати Admin-доступ" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Сесія застаріла");
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    it("без даних персональних РК пропонує повторну перевірку та блокує запуск", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Пошерити РК" }));
        expect(screen.getByText(/щоб визначити персональні РК/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Надати Admin-доступ" })).toBeDisabled();
    });
    it("запускає заявки лише для вибраних профілів із введеним Facebook ID", async () => {
        render(<AutouploadTab />);
        expect(screen.getByRole("button", { name: "Додати в друзі" })).toBeDisabled();
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Додати в друзі" }));
        fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "456" } });
        expect(window.adsBot.sendAutouploadFriendRequests).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Надіслати заявки" }));
        await waitFor(() => expect(window.adsBot.sendAutouploadFriendRequests).toHaveBeenCalledWith(["p1"], "456"));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
    it("відхиляє некоректний ID до запуску задачі", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Додати в друзі" }));
        fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "not-id" } });
        fireEvent.click(screen.getByRole("button", { name: "Надіслати заявки" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("числовий Facebook ID");
        expect(window.adsBot.sendAutouploadFriendRequests).not.toHaveBeenCalled();
    });
    it("показує помилку заявки та фактичні коди окремо від активної сесії", async () => {
        const action = { operation: "friend-request", message: "Request rejected", success: false, outcome: "NOT_CONFIRMED", code: "FACEBOOK_GRAPHQL_ERROR", httpStatus: 200, graphCode: 1234, apiErrorCode: 5678, targetUserId: "456", errors: [], steps: [], fields: [] };
        window.adsBot.getAutoupload.mockImplementation(() => ok({ ...state, profiles: [{ ...state.profiles[0], status: "active", lastAction: action }], history: [{ ...action, id: "history1", profileId: "p1", profileNo: "12", checkedAt: "2026-10-22T12:00:00Z" }] }));
        render(<AutouploadTab />);
        expect(await screen.findByRole("img", { name: "Стан акаунта: Акаунт активний" })).toHaveClass("success");
        fireEvent.click(screen.getByRole("button", { name: "Деталі" }));
        expect(screen.getByRole("dialog")).toHaveTextContent("FACEBOOK_GRAPHQL_ERROR");
        expect(screen.getByRole("dialog")).toHaveTextContent("1234");
        expect(screen.getByRole("dialog")).toHaveTextContent("5678");
    });
    it("кнопка запуску стає червоною та повертається у звичайний стан після закриття", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Відкрити профіль 12" }));
        const close = await screen.findByRole("button", { name: "Закрити профіль 12" });
        expect(close).toHaveClass("danger");
        await waitFor(() => expect(close).toBeEnabled());
        fireEvent.click(close);
        const open = await screen.findByRole("button", { name: "Відкрити профіль 12" });
        expect(open).not.toHaveClass("danger");
        expect(window.adsBot.controlAutouploadProfile.mock.calls).toEqual([["p1", "open"], ["p1", "close"]]);
    });
    it("показує статус і ставить перевірку вибраного профілю в чергу", async () => {
        render(<AutouploadTab />);
        expect(await screen.findByText("Test profile")).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Стан акаунта: Потрібна авторизація" })).toHaveClass("danger");
        fireEvent.click(screen.getByRole("checkbox", { name: "Вибрати профіль 12" }));
        fireEvent.click(screen.getByRole("button", { name: "Перевірити сесію" }));
        await waitFor(() => expect(window.adsBot.checkAutouploadSessions).toHaveBeenCalledWith(["p1"]));
    });
    it("видалення локальної групи проходить через явне модальне вікно", async () => {
        render(<AutouploadTab />);
        fireEvent.click(await screen.findByRole("button", { name: "Видалити Готові" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(window.adsBot.mutateAutoupload).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
        await waitFor(() => expect(window.adsBot.mutateAutoupload).toHaveBeenCalledWith({ action: "delete", id: "ready", name: "" }));
    });
    it("додає вибрані профілі в групу Нові", async () => {
        const onAdded = vi.fn();
        render(<AutouploadAddModal profiles={[{ profileId: "p1" }]} onAdded={onAdded} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByRole("button", { name: "Додати" })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "Додати" }));
        await waitFor(() => expect(window.adsBot.mutateAutoupload).toHaveBeenCalledWith({ action: "add", ids: ["p1"], groupId: "new" }));
        await waitFor(() => expect(onAdded).toHaveBeenCalled());
    });
    it("оновлення під час завантаження не перезаписується старою відповіддю", async () => {
        let resolve;
        let updated;
        window.adsBot.getAutoupload.mockImplementation(() => new Promise((done) => { resolve = done; }));
        window.adsBot.onAutouploadUpdated.mockImplementation((callback) => { updated = callback; return () => {}; });
        render(<AutouploadTab />);
        updated({ ...state, profiles: [{ ...state.profiles[0], name: "Fresh" }] });
        resolve({ ok: true, data: state });
        expect(await screen.findByText("Fresh")).toBeInTheDocument();
        expect(screen.queryByText("Test profile")).not.toBeInTheDocument();
    });
});
