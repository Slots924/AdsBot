import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PersonalBusinessInfoForm from "../components/PersonalBusinessInfoForm.jsx";

const emptyBusiness = {
    countryCode: "", currency: "", timezone: "", street1: "", street2: "",
    city: "", state: "", zip: "",
};

beforeEach(() => {
    const storage = new Map();
    vi.stubGlobal("localStorage", {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("Бізнес-інформація персонального акаунта", () => {
    it("відкриває дефолтні значення без попередньої перевірки та відправляє їх після підтвердження", async () => {
        const onSave = vi.fn().mockResolvedValue({ countryCode: "US" });
        const onCheck = vi.fn();
        const user = userEvent.setup();
        render(<PersonalBusinessInfoForm value={emptyBusiness} ready checked={false} busy={false} onCheck={onCheck} onSave={onSave} />);

        expect(screen.getByLabelText("Вулиця, будинок")).toHaveValue("");
        expect(screen.getByLabelText("Вулиця, будинок")).toHaveAttribute("readonly");
        await user.click(screen.getByRole("button", { name: "Оновити бізнес-інфу" }));
        const editor = within(screen.getByRole("dialog"));
        expect(editor.getByLabelText("Вулиця, будинок")).toHaveValue("1600 Pennsylvania Avenue NW");
        expect(editor.getByLabelText("Валюта")).toHaveValue("USD");
        expect(editor.getByLabelText("Часовий пояс")).toHaveTextContent("UTC+0 · Рейк’явік, Ісландія");
        expect(onSave).not.toHaveBeenCalled();
        await user.click(editor.getByRole("button", { name: "Оновити інформацію" }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            countryCode: "US", city: "Washington", state: "DC", zip: "20500",
            currency: "USD", timezone: "Atlantic/Reykjavik",
        }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(onCheck).not.toHaveBeenCalled();
    });

    it("зберігає обраний пояс зірочкою для наступних відкриттів і повторного монтування", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();
        const props = { value: emptyBusiness, ready: true, checked: false, busy: false, onCheck: vi.fn(), onSave };
        const view = render(<PersonalBusinessInfoForm {...props} />);
        await user.click(screen.getByRole("button", { name: "Оновити бізнес-інфу" }));
        let editor = within(screen.getByRole("dialog"));
        await user.click(editor.getByLabelText("Часовий пояс"));
        expect(editor.getByRole("button", { name: "За замовчуванням: UTC+0 · Рейк’явік, Ісландія" })).toHaveAttribute("aria-pressed", "true");
        await user.click(editor.getByRole("button", { name: "За замовчуванням: UTC+3 · Київ, Україна" }));
        expect(editor.getByRole("button", { name: "За замовчуванням: UTC+3 · Київ, Україна" })).toHaveAttribute("aria-pressed", "true");
        expect(onSave).not.toHaveBeenCalled();
        view.unmount();
        render(<PersonalBusinessInfoForm {...props} />);
        await user.click(screen.getByRole("button", { name: "Оновити бізнес-інфу" }));
        editor = within(screen.getByRole("dialog"));
        expect(editor.getByLabelText("Часовий пояс")).toHaveTextContent("UTC+3 · Київ, Україна");
        await user.click(editor.getByLabelText("Часовий пояс"));
        await user.click(editor.getByText("UTC+0 · Рейк’явік, Ісландія").closest("button"));
        expect(editor.getByLabelText("Часовий пояс")).toHaveTextContent("UTC+0 · Рейк’явік, Ісландія");
        await user.click(editor.getByRole("button", { name: "Оновити інформацію" }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Atlantic/Reykjavik" }));
        await user.click(editor.getByRole("button", { name: "Скасувати" }));
        await user.click(screen.getByRole("button", { name: "Оновити бізнес-інфу" }));
        expect(within(screen.getByRole("dialog")).getByLabelText("Часовий пояс")).toHaveTextContent("UTC+3 · Київ, Україна");
    });

    it("зберігає введені значення у редакторі, якщо оновлення не вдалося", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn().mockResolvedValue(null);
        render(<PersonalBusinessInfoForm value={emptyBusiness} ready checked={false} busy={false} onCheck={vi.fn()} onSave={onSave} />);
        await user.click(screen.getByRole("button", { name: "Оновити бізнес-інфу" }));
        const editor = within(screen.getByRole("dialog"));
        await user.clear(editor.getByLabelText("Місто"));
        await user.type(editor.getByLabelText("Місто"), "Seattle");
        await user.click(editor.getByRole("button", { name: "Оновити інформацію" }));
        expect(editor.getByLabelText("Місто")).toHaveValue("Seattle");
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
});
