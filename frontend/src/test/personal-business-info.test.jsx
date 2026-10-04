import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PersonalBusinessInfoForm from "../components/PersonalBusinessInfoForm.jsx";

const emptyBusiness = {
    countryCode: "", currency: "", timezone: "", street1: "", street2: "",
    city: "", state: "", zip: "",
};

afterEach(cleanup);

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
        expect(editor.getByLabelText("Часовий пояс")).toHaveValue("Europe/Kiev");
        expect(onSave).not.toHaveBeenCalled();
        await user.click(editor.getByRole("button", { name: "Оновити інформацію" }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            countryCode: "US", city: "Washington", state: "DC", zip: "20500",
            currency: "USD", timezone: "Europe/Kiev",
        }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(onCheck).not.toHaveBeenCalled();
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
