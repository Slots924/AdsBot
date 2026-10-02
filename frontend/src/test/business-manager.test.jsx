import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BusinessManagerTab from "../tabs/BusinessManagerTab.jsx";

const snapshot = { value: {
    users: [{ id: "11", name: "Test Person", email: "person@example.com", role: "EMPLOYEE", finance_permission: "FINANCE_EDITOR" }], pending: [],
    pages: [{ id: "21", name: "Page Alpha", assignedUsers: [{ id: "11", tasks: ["ANALYZE"] }] }, { id: "22", name: "Page Beta", assignedUsers: [] }],
    adAccounts: [{ id: "act_31", name: "Account", account_status: 1, assignedUsers: [] }],
}, updatedAt: "2026-10-02T10:00:00Z" };
let bmRequest;
beforeEach(() => {
    bmRequest = vi.fn(async (payload) => {
        const data = payload.action === "preferences" ? { accountKey: "system-001", businessId: "1", section: "users" }
            : payload.action === "list" ? { value: [{ id: "1", name: "Test BM" }] }
            : payload.action === "section" ? snapshot
            : payload.action === "invite" ? { invited: true, snapshot }
            : payload.action === "userAssets" ? { total: 1, successful: 1, people: 1, failed: [], snapshot }
            : true;
        return { ok: true, data };
    });
    window.adsBot = { bmRequest, onBMProgress: vi.fn(() => () => {}) };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const show = () => render(<BusinessManagerTab accounts={[{ accountKey: "system-001", name: "System", kind: "system" }, { accountKey: "api-001", name: "Regular API", kind: "api" }]} />);
const loaded = async () => screen.findByText("Test Person");

describe("БМ", () => {
    it("відкриває кеш без запитів оновлення та виключає звичайних API-клієнтів", async () => {
        show(); await loaded();
        expect(bmRequest.mock.calls.some(([payload]) => payload.force)).toBe(false);
        fireEvent.focus(screen.getByRole("combobox", { name: "API-клієнт БМ" }));
        expect(screen.queryByRole("option", { name: "Regular API" })).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "System" })).toBeInTheDocument();
    });

    it("перевіряє email та надсилає обрану роль", async () => {
        show(); await loaded();
        fireEvent.click(screen.getByRole("button", { name: "Запросити користувача" }));
        expect(screen.getByText("Введіть коректну email-адресу")).toBeInTheDocument();
        expect(bmRequest.mock.calls.some(([payload]) => payload.action === "invite")).toBe(false);
        fireEvent.change(screen.getByLabelText("Email для запрошення"), { target: { value: "admin@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Запросити адміна" }));
        await screen.findByText("✓ Інвайт відправлено на admin@example.com");
        expect(bmRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "invite", role: "ADMIN", email: "admin@example.com" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("прибирає успішний інвайт через 5 секунд", async () => {
        show(); await loaded();
        vi.useFakeTimers();
        fireEvent.change(screen.getByLabelText("Email для запрошення"), { target: { value: "user@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Запросити користувача" }));
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(screen.getByText("✓ Інвайт відправлено на user@example.com")).toBeInTheDocument();
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(screen.queryByText("✓ Інвайт відправлено на user@example.com")).not.toBeInTheDocument();
    });

    it("показує помилку інвайту під кнопками", async () => {
        show(); await loaded();
        bmRequest.mockImplementation(async (payload) => payload.action === "invite" ? { ok: false, error: { message: "Немає дозволу" } } : { ok: true, data: snapshot });
        fireEvent.change(screen.getByLabelText("Email для запрошення"), { target: { value: "user@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Запросити користувача" }));
        await screen.findByText("Немає дозволу");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("зберігає вибір при пошуку й надсилає початкові доступи для перевірки конфлікту", async () => {
        show(); await loaded();
        fireEvent.click(screen.getByRole("button", { name: "1 / 2" }));
        const modal = screen.getByRole("dialog");
        const search = within(modal).getByRole("textbox", { name: "Назва або ID" });
        fireEvent.change(search, { target: { value: "Beta" } });
        fireEvent.click(within(modal).getByRole("button", { name: "Вибрати знайдені" }));
        fireEvent.change(search, { target: { value: "Alpha" } });
        expect(within(modal).getByRole("checkbox")).toBeChecked();
        fireEvent.click(within(modal).getByRole("button", { name: "Застосувати" }));
        await waitFor(() => expect(bmRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "userAssets", kind: "pages", originalIds: ["21"], selectedIds: ["21", "22"] })));
        await screen.findByRole("dialog", { name: "Результат зміни доступів" });
    });

    it("масова видача починається після підтвердження", async () => {
        show(); await loaded();
        fireEvent.click(screen.getByRole("button", { name: "Надати всім усі доступи" }));
        expect(bmRequest.mock.calls.some(([payload]) => payload.action === "grantAll")).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
        await waitFor(() => expect(bmRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "grantAll" })));
    });
});
