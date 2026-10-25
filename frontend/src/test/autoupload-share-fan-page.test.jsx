import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AutouploadTab from "../tabs/AutouploadTab.jsx";
import AutouploadShareFanPageModal from "../components/AutouploadShareFanPageModal.jsx";

const profile = { profileId: "p1", profileNo: "12", name: "Test profile", groupId: "new", status: "active" };
const pages = [{ additionalProfileId: "100", name: "Перша фанка", photoUrl: null }, { additionalProfileId: "200", name: "Друга фанка", photoUrl: null }];
const ok = data => Promise.resolve({ ok: true, data });
beforeEach(() => {
    window.adsBot = {
        getAutoupload: vi.fn(() => ok({ profiles: [profile, { ...profile, profileId: "p2", profileNo: "13" }], groups: [{ id: "new", name: "Нові" }], history: [] })),
        onAutouploadUpdated: vi.fn(() => () => {}),
        getAutouploadFanPages: vi.fn(() => ok({ success: true, pages })),
        shareAutouploadFanPage: vi.fn(() => ok({ success: true, outcome: "INVITE_SENT", message: "Запрошення надіслано." })),
    };
});
afterEach(() => { cleanup(); delete window.adsBot; });

it("дія доступна лише для одного вибраного профілю", async () => {
    render(<AutouploadTab />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
    fireEvent.click(screen.getByRole("button", { name: "Дії ▾" }));
    expect(screen.getByRole("button", { name: "Пошарити фанку" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Вибрати профіль 13" }));
    expect(screen.getByRole("button", { name: "Пошарити фанку" })).toBeDisabled();
});

it("список завантажується тільки кнопкою, успіх залишає модалку відкритою для наступної фанки", async () => {
    render(<AutouploadShareFanPageModal profile={profile} onClose={vi.fn()} />);
    expect(window.adsBot.getAutouploadFanPages).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отримати список фанок" }));
    await screen.findByText("Перша фанка");
    expect(window.adsBot.getAutouploadFanPages).toHaveBeenCalledWith(["p1"]);
    expect(screen.getByRole("button", { name: "Пошарити Перша фанка" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Пошарити Перша фанка" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Пошарити Перша фанка" }));
    await screen.findByText("Перша фанка · Запрошення надіслано.");
    expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledWith({ ids: ["p1"], additionalProfileId: "100", targetUserId: "300" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пошарити Перша фанка" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Пошарити Друга фанка" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveClass("is-success");
    fireEvent.click(screen.getByRole("button", { name: "Пошарити Друга фанка" }));
    await waitFor(() => expect(window.adsBot.shareAutouploadFanPage).toHaveBeenCalledTimes(2));
});

it("помилка показується внизу та не закриває модалку, невизначений запис блокує повтор для цієї пари ID", async () => {
    window.adsBot.shareAutouploadFanPage.mockImplementation(() => ok({ success: false, outcomeUnknown: true, message: "Результат невідомий" }));
    render(<AutouploadShareFanPageModal profile={profile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Отримати список фанок" }));
    await screen.findByText("Перша фанка");
    fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Пошарити Перша фанка" }));
    expect(await screen.findByRole("alert")).toHaveClass("is-error");
    expect(screen.getByRole("button", { name: "Пошарити Перша фанка" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "400" } });
    expect(screen.getByRole("button", { name: "Пошарити Перша фанка" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("під час запиту не можна змінити отримувача, закрити вікно чи запустити іншу фанку", async () => {
    let resolve;
    window.adsBot.shareAutouploadFanPage.mockImplementation(() => new Promise(done => { resolve = done; }));
    const onClose = vi.fn();
    render(<AutouploadShareFanPageModal profile={profile} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Отримати список фанок" }));
    await screen.findByText("Перша фанка");
    fireEvent.change(screen.getByLabelText("Facebook ID отримувача"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Пошарити Перша фанка" }));
    expect(screen.getByLabelText("Facebook ID отримувача")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрити" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Пошарити Друга фанка" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolve({ ok: true, data: { success: true, message: "Готово" } });
    await waitFor(() => expect(screen.getByLabelText("Facebook ID отримувача")).toBeEnabled());
});

it("помилка завантаження списку не маскується під порожній успіх", async () => {
    window.adsBot.getAutouploadFanPages.mockImplementation(() => ok({ success: false, message: "Сесія недоступна" }));
    render(<AutouploadShareFanPageModal profile={profile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Отримати список фанок" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сесія недоступна");
});
