import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TemplatesTab from "../tabs/TemplatesTab.jsx";

describe("Налаштування аудиторії та плейсментів шаблону", () => {
    beforeEach(() => {
        window.adsBot = {
            getTemplates: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            getLanguages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            createTemplate: vi.fn().mockImplementation(async (input) => ({ ok: true, data: { ...input, id: 1 } })),
        };
    });
    afterEach(() => { cleanup(); delete window.adsBot; });

    it("зберігає перемикачі та синхронізує вік із мінімумом Advantage+", async () => {
        render(<TemplatesTab onError={vi.fn()} showToast={vi.fn()} />);
        await screen.findByText("Шаблонів ще немає");
        fireEvent.click(screen.getByText("Створити шаблон"));
        const advantage = screen.getByRole("switch", { name: "Увімкнути Advantage+" });
        const limited = screen.getByRole("switch", { name: "Обмежені витрати на виключені плейсменти" });
        const minimum = screen.getByRole("combobox", { name: "Мінімальний вік Advantage+" });
        expect(advantage).not.toBeChecked();
        expect(limited).toBeChecked();
        expect(minimum).toBeDisabled();
        expect(within(minimum).getAllByRole("option").map((option) => Number(option.value)))
            .toEqual([18, 19, 20, 21, 22, 23, 24, 25]);
        fireEvent.focus(screen.getByLabelText("Вік до"));
        fireEvent.change(screen.getByLabelText("Вік до"), { target: { value: "21" } });
        fireEvent.click(screen.getByRole("button", { name: "21", exact: true }));
        fireEvent.click(advantage);
        expect(minimum).toBeEnabled();
        fireEvent.change(minimum, { target: { value: "25" } });
        expect(screen.getByLabelText("Вік від")).toHaveValue("25");
        expect(screen.getByLabelText("Вік до")).toHaveValue("25");
        fireEvent.focus(screen.getByLabelText("Вік від"));
        fireEvent.change(screen.getByLabelText("Вік від"), { target: { value: "18" } });
        expect(screen.getByText("Немає такого віку")).toBeInTheDocument();
        fireEvent.blur(screen.getByLabelText("Вік від"));
        expect(screen.getByLabelText("Вік від")).toHaveValue("25");
        fireEvent.mouseDown(screen.getByText("Аудиторія", { selector: "strong" }));
        fireEvent.click(advantage);
        expect(minimum).toBeDisabled();
        fireEvent.click(advantage);
        fireEvent.click(limited);
        fireEvent.change(screen.getByPlaceholderText("Наприклад, AT Slot"), { target: { value: "Audience test" } });
        fireEvent.submit(screen.getByText("Новий шаблон").closest("form"));
        await waitFor(() => expect(window.adsBot.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
            advantageAudience: true, minimumAge: 25, ageMin: 25, ageMax: 25, allowLimitedPlacementSpend: false,
        })));
    });

    it("відновлює збережені налаштування під час редагування", async () => {
        window.adsBot.getTemplates.mockResolvedValue({ ok: true, data: [{
            id: 1, name: "Saved", advantageAudience: true, minimumAge: 23,
            ageMin: 30, ageMax: 55, allowLimitedPlacementSpend: false,
        }] });
        render(<TemplatesTab onError={vi.fn()} showToast={vi.fn()} />);
        fireEvent.click(await screen.findByText("Saved"));
        expect(screen.getByRole("switch", { name: "Увімкнути Advantage+" })).toBeChecked();
        expect(screen.getByRole("switch", { name: "Обмежені витрати на виключені плейсменти" })).not.toBeChecked();
        expect(screen.getByRole("combobox", { name: "Мінімальний вік Advantage+" })).toHaveValue("23");
        expect(screen.getByLabelText("Вік від")).toHaveValue("30");
    });
});
