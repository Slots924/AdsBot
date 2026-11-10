import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
        deleteCreativeOriginal: vi.fn(() => ok({})),
        deleteCreativeVariant: vi.fn(() => ok({})),
        deleteCreative: vi.fn(() => ok({})),
    };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("підтверджує повне видалення без перемикання вибору та дозволяє скасувати", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: "Видалити весь креатив 202" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Буде видалено оригінал і всі мовні версії");
    expect(window.adsBot.getCreativeOriginal).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати" }));
    expect(window.adsBot.deleteCreative).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("видаляє оригінал і відкриває мовну версію", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    await screen.findByDisplayValue("Оригінал");
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: false, countries: ["UA", "US"] }]));
    fireEvent.click(screen.getByRole("button", { name: "Видалити" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити" }));
    await screen.findByDisplayValue("Текст UA");
    expect(window.adsBot.deleteCreativeOriginal).toHaveBeenCalledWith({ name: "202" });
    expect(window.adsBot.deleteCreative).not.toHaveBeenCalled();
});

it("видаляє конкретну мову та повертається до оригіналу", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    await screen.findByDisplayValue("Оригінал");
    fireEvent.click(screen.getByRole("button", { name: "UA" }));
    await screen.findByDisplayValue("Текст UA");
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: true, countries: ["US"] }]));
    fireEvent.click(screen.getByRole("button", { name: "Видалити" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("мовну версію UA");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити" }));
    await screen.findByDisplayValue("Оригінал");
    expect(window.adsBot.deleteCreativeVariant).toHaveBeenCalledWith({ name: "202", geo: "UA" });
    expect(screen.queryByRole("button", { name: "UA" })).not.toBeInTheDocument();
});

it("повне видалення іншого рядка зберігає незбережений редактор", async () => {
    window.adsBot.getCreatives.mockImplementation(() => ok([
        { name: "202", hasOriginal: true, countries: ["UA"] },
        { name: "203", hasOriginal: true, countries: [] },
    ]));
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    fireEvent.change(await screen.findByDisplayValue("Оригінал"), { target: { value: "Зміни" } });
    fireEvent.click(screen.getByRole("button", { name: "Видалити весь креатив 203" }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Незбережені зміни буде втрачено");
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: true, countries: ["UA"] }]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити все" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("Зміни")).toBeInTheDocument();
    expect(window.adsBot.deleteCreative).toHaveBeenCalledWith({ name: "203" });
});

it("попереджає про незбережені зміни та очищає видалений креатив", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    fireEvent.change(await screen.findByDisplayValue("Оригінал"), { target: { value: "Зміни" } });
    fireEvent.click(screen.getByRole("button", { name: "Видалити весь креатив 202" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Незбережені зміни буде втрачено");
    window.adsBot.getCreatives.mockImplementation(() => ok([]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити все" }));
    await screen.findByText("Виберіть креатив");
    expect(screen.queryByRole("button", { name: /^202/ })).not.toBeInTheDocument();
});

it("при помилці зберігає редактор і оновлює фактичний список", async () => {
    const showToast = vi.fn();
    window.adsBot.deleteCreative.mockResolvedValue({ ok: false, error: { message: "Не всі файли видалено" } });
    render(<CreativesTab showToast={showToast}/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    fireEvent.change(await screen.findByDisplayValue("Оригінал"), { target: { value: "Зміни" } });
    fireEvent.click(screen.getByRole("button", { name: "Видалити весь креатив 202" }));
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: true, countries: ["US"] }]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити все" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не всі файли видалено");
    expect(screen.getByDisplayValue("Зміни")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "UA" })).not.toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
});

it("блокує повторне видалення та редагування під час запиту", async () => {
    let finish;
    window.adsBot.deleteCreativeOriginal.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    await screen.findByDisplayValue("Оригінал");
    fireEvent.click(screen.getByRole("button", { name: "Видалити" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити" }));
    const pending = screen.getByRole("button", { name: "Видалення…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(screen.getByDisplayValue("Оригінал")).toBeDisabled();
    expect(screen.getByRole("button", { name: "UA" })).toBeDisabled();
    expect(window.adsBot.deleteCreativeOriginal).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: {} });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("не пропонує видаляти новий або відсутній оригінал", async () => {
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: false, countries: ["UA"] }]));
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    expect(screen.queryByRole("button", { name: "Видалити" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Додати креатив" }));
    expect(screen.queryByRole("button", { name: "Видалити" })).not.toBeInTheDocument();
});

it("очищає вибір після видалення останньої версії", async () => {
    window.adsBot.getCreatives.mockImplementation(() => ok([{ name: "202", hasOriginal: true, countries: [] }]));
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    await screen.findByDisplayValue("Оригінал");
    fireEvent.click(screen.getByRole("button", { name: "Видалити" }));
    window.adsBot.getCreatives.mockImplementation(() => ok([]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Видалити" }));
    await screen.findByText("Виберіть креатив");
});

it("показує країни з локальними прапорами та зберігає вибрану версію", async () => {
    render(<CreativesTab/>);
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
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
    await screen.findByRole("button", { name: /^202/ });
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
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
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
    fireEvent.click(await screen.findByRole("button", { name: /^202/ }));
    fireEvent.change(await screen.findByDisplayValue("Оригінал"), { target: { value: "Зміни" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Файл недоступний");
    expect(screen.getByDisplayValue("Зміни")).toBeInTheDocument();
});
