import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreativesTab from "../tabs/CreativesTab.jsx";

const ok = (data) => Promise.resolve({ ok: true, data });
beforeEach(() => {
    window.adsBot = {
        getCreatives: vi.fn(() => ok([{ name: "202", hasOriginal: true, countries: ["UA", "US"] }])),
        getCountries: vi.fn(() => ok([{ code: "UA", name: "Ukraine" }, { code: "US", name: "United States" }])),
        getCreativeOriginal: vi.fn(() => ok({ text: "Оригінал" })),
        getCreativeVariant: vi.fn(() => ok({ creative: "Текст UA", comments: [] })),
        saveCreativeOriginal: vi.fn(() => ok({})),
        saveCreativeVariant: vi.fn(() => ok({})),
    };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("показує країни з локальними прапорами та зберігає вибрану версію", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /202/ }));
    await screen.findByDisplayValue("Оригінал");
    const country = screen.getByRole("button", { name: "UA" });
    expect(country.querySelector("img")).toHaveAttribute("src", "/flags/ua.svg");
    fireEvent.click(country);
    const text = await screen.findByDisplayValue("Текст UA");
    fireEvent.change(text, { target: { value: "Оновлений текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.adsBot.saveCreativeVariant).toHaveBeenCalledWith({ name: "202", geo: "UA", creative: { creative: "Оновлений текст", comments: [] } }));
    expect(window.adsBot.saveCreativeOriginal).not.toHaveBeenCalled();
});

it("додає оригінал і шукає креативи", async () => {
    render(<CreativesTab/>);
    await screen.findByRole("button", { name: /202/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Пошук креативів" }), { target: { value: "none" } });
    expect(screen.getByText("Нічого не знайдено")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Додати креатив" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Назва/ }), { target: { value: "203" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Текст оригіналу" }), { target: { value: "Новий оригінал" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.adsBot.saveCreativeOriginal).toHaveBeenCalledWith({ name: "203", text: "Новий оригінал", create: true }));
});

it("не зберігає невалідні коментарі та показує помилку", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /202/ }));
    await screen.findByDisplayValue("Оригінал");
    fireEvent.click(screen.getByRole("button", { name: "UA" }));
    await screen.findByDisplayValue("Текст UA");
    fireEvent.click(screen.getByText("Коментарі · редагування JSON"));
    fireEvent.change(screen.getByLabelText("Коментарі JSON"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("невалідний JSON");
    expect(window.adsBot.saveCreativeVariant).not.toHaveBeenCalled();
});

it("зберігає введений текст після помилки backend", async () => {
    window.adsBot.saveCreativeOriginal.mockResolvedValue({ ok: false, error: { message: "Файл недоступний" } });
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /202/ }));
    fireEvent.change(await screen.findByDisplayValue("Оригінал"), { target: { value: "Зміни" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Файл недоступний");
    expect(screen.getByDisplayValue("Зміни")).toBeInTheDocument();
});
