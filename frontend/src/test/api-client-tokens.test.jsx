import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar.jsx";

const credentials = { accessToken: "mock-access", cookie: "c_user=1", userAgent: "Mock UA", afpToken: "mock-afp", afpUserAgent: "Custom AFP UA" };
const account = { accountKey: "account-001", kind: "api", name: "Client", tokenMode: "access", adsPowerProfileNo: "123", hasCookie: true, hasUserAgent: true, hasAccessToken: true, hasAfpToken: true };
const show = (overrides = {}) => {
    const props = { standalone: true, accounts: [account], onUpdate: vi.fn().mockResolvedValue(), onCreate: vi.fn().mockResolvedValue(), onRefresh: vi.fn(), onSelect: vi.fn(), onCheck: vi.fn(), onError: vi.fn(), ...overrides };
    render(<Sidebar {...props} />);
    return props;
};

beforeEach(() => {
    window.adsBot = { getAccountEditorCredentials: vi.fn().mockResolvedValue({ ok: true, data: credentials }) };
});
afterEach(cleanup);

describe("Токени API-клієнтів", () => {
    it("блокує AFP на картці без токена, але дозволяє відкрити його налаштування", async () => {
        const props = show({ accounts: [{ ...account, hasAfpToken: false }] });
        const afp = screen.getByRole("button", { name: "AFP token" });
        expect(afp).toBeDisabled();
        fireEvent.click(afp);
        expect(props.onUpdate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("Редагувати"));
        const dialog = within(await screen.findByRole("dialog"));
        expect(dialog.getByRole("button", { name: "AFP token" })).toBeEnabled();
    });

    it("дозволяє перейти на AFP після додавання токена", async () => {
        const props = show();
        const afp = screen.getByRole("button", { name: "AFP token" });
        expect(afp).toBeEnabled();
        fireEvent.click(afp);
        await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(account.accountKey, { tokenMode: "afp" }));
    });

    it("завантажує секрети лише для редактора, приховує їх і зберігає обидві вкладки", async () => {
        const props = show();
        expect(window.adsBot.getAccountEditorCredentials).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("Редагувати"));
        const dialog = within(await screen.findByRole("dialog"));
        const token = dialog.getByLabelText("accessToken", { exact: true });
        expect(token).toHaveValue(credentials.accessToken);
        expect(token).toHaveAttribute("type", "password");
        expect(dialog.getByLabelText("userAgent")).toHaveValue(credentials.userAgent);
        fireEvent.click(dialog.getByRole("button", { name: "Показати accessToken" }));
        expect(token).toHaveAttribute("type", "text");
        fireEvent.change(dialog.getByLabelText("Cookie або AdsPower JSON", { exact: true }), { target: { value: "" } });
        fireEvent.click(dialog.getByRole("button", { name: "AFP token" }));
        expect(dialog.getByLabelText("AFP token", { exact: true })).toHaveValue(credentials.afpToken);
        expect(dialog.getByLabelText("AFP User-Agent")).toHaveValue(credentials.afpUserAgent);
        fireEvent.change(dialog.getByLabelText("AFP token", { exact: true }), { target: { value: "new-mock-afp" } });
        fireEvent.click(dialog.getByRole("button", { name: "Access token" }));
        expect(dialog.getByLabelText("accessToken", { exact: true })).toHaveValue(credentials.accessToken);
        expect(dialog.getByLabelText("Cookie або AdsPower JSON", { exact: true })).toHaveValue("");
        fireEvent.click(dialog.getByRole("button", { name: "Зберегти зміни" }));
        await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(account.accountKey, expect.objectContaining({ tokenMode: "access", accessToken: credentials.accessToken, afpToken: "new-mock-afp", cookie: "", replaceCredentials: true })));
    });

    it("перемикає токен без вибору картки, у AFP блокує синхронізацію й оновлення через cookie", async () => {
        const props = show({ accounts: [{ ...account, tokenMode: "afp" }] });
        expect(screen.getByRole("button", { name: "AFP token" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Оновити access token" })).toBeDisabled();
        expect(screen.getByTitle("Синхронізувати з AdsPower")).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Access token" }));
        await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(account.accountKey, { tokenMode: "access" }));
        expect(props.onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("Перевірити, чи працює API-клієнт"));
        expect(props.onCheck).toHaveBeenCalledWith(account.accountKey);
    });

    it("створює клієнта без необов’язкових облікових даних AFP", async () => {
        const props = show({ accounts: [] });
        fireEvent.click(screen.getByTitle("Додати акаунт"));
        const dialog = within(screen.getByRole("dialog"));
        fireEvent.change(dialog.getByLabelText("Назва API-клієнта"), { target: { value: "New client" } });
        fireEvent.click(dialog.getByRole("button", { name: "AFP token" }));
        expect(dialog.getByLabelText("AFP User-Agent").value).toContain("Windows NT");
        fireEvent.click(dialog.getByRole("button", { name: "Створити" }));
        await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "New client", afpToken: "", accessToken: "", cookie: "" })));
    });

    it("не відкриває порожній редактор після помилки завантаження секретів", async () => {
        window.adsBot.getAccountEditorCredentials.mockResolvedValue({ ok: false, error: { message: "Unavailable" } });
        const props = show();
        fireEvent.click(screen.getByTitle("Редагувати"));
        await waitFor(() => expect(props.onError).toHaveBeenCalled());
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(props.onUpdate).not.toHaveBeenCalled();
    });
});
