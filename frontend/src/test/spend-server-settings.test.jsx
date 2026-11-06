import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SpendServerSettings from "../components/SpendServerSettings.jsx";
import { defaultAfpUserAgent } from "../../../facebook/api/accountCredentials.js";

afterEach(cleanup);

it("Завантажує Windows UA та cookies, зберігає налаштування Spend Server", async () => {
    const settings = { url: "", clientKey: "", userAgent: defaultAfpUserAgent, cookies: "c_user=123; xs=mock" };
    const save = vi.fn(async (payload) => ({ ok: true, data: payload }));
    window.adsBot = { getSpendServerSettings: vi.fn(async () => ({ ok: true, data: settings })), saveSpendServerSettings: save };
    render(<SpendServerSettings />);
    const userAgent = await screen.findByRole("combobox", { name: "User-Agent" });
    expect(userAgent.value).toBe(defaultAfpUserAgent);
    expect(screen.getByLabelText(/Cookies Facebook/).value).toBe(settings.cookies);
    expect(screen.getByLabelText(/Cookies Facebook/).type).toBe("password");
    fireEvent.change(screen.getByLabelText(/Адреса сервера/), { target: { value: "https://spend.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...settings, url: "https://spend.example.com" }));
});

it("Показує помилку збереження без втрати введених даних", async () => {
    const onError = vi.fn();
    window.adsBot = {
        getSpendServerSettings: async () => ({ ok: true, data: { url: "", clientKey: "", userAgent: defaultAfpUserAgent, cookies: "" } }),
        saveSpendServerSettings: async () => ({ ok: false, error: { message: "Некоректні cookies" } }),
    };
    render(<SpendServerSettings onError={onError} />);
    fireEvent.click(await screen.findByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.getByRole("combobox", { name: "User-Agent" }).value).toBe(defaultAfpUserAgent);
});

it("Приховує секрети, перемикає видимість окремо та приховує після збереження", async () => {
    const settings = { url: "https://spend.example.com/fb_data/add", clientKey: "mock-key", userAgent: defaultAfpUserAgent, cookies: "c_user=123; xs=mock" };
    window.adsBot = {
        getSpendServerSettings: async () => ({ ok: true, data: settings }),
        saveSpendServerSettings: async (data) => ({ ok: true, data }),
    };
    render(<SpendServerSettings />);
    const key = await screen.findByLabelText("Client Key");
    const cookies = screen.getByLabelText(/Cookies Facebook/);
    expect(key.type).toBe("password");
    expect(cookies.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Показати Client Key" }));
    expect(key.type).toBe("text");
    expect(cookies.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Показати cookies" }));
    expect(cookies.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Приховати Client Key" }));
    expect(key.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(cookies.type).toBe("password"));
});
