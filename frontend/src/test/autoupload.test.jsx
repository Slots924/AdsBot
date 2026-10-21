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
        controlAutouploadProfile: vi.fn((_profileId, action) => ok({ profileId: "p1", adsPowerOpen: action === "open" })),
    };
});
afterEach(() => { cleanup(); delete window.adsBot; });

describe("Автозаливи", () => {
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
        expect(screen.getByText("Потрібна авторизація")).toHaveClass("danger");
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
