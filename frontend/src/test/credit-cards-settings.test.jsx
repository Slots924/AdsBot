import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreditCardsSettings from "../components/CreditCardsSettings.jsx";
import PersonalPaymentCardSelect from "../components/PersonalPaymentCardSelect.jsx";
import { sortAdAccounts } from "../components/AdAccountSelect.jsx";

afterEach(cleanup);

const card = {
    id: "card-test", nickname: "Test", cardholderName: "Test Owner", expiration: "09/28",
    postalCode: "", countryCode: "US", network: "MASTERCARD", last4: "4444", displayNumber: "••••4444", hasSecurityCode: true,
};

describe("CVV у налаштуваннях карток", () => {
    it("створює та вибирає картку через плюс біля пошукового списку", async () => {
        window.adsBot = { createCreditCard: vi.fn().mockResolvedValue({ ok: true, data: card }) };
        const onCreated = vi.fn();
        const onChange = vi.fn();
        render(<PersonalPaymentCardSelect cards={[card]} value="" onChange={onChange} onCreated={onCreated} />);
        fireEvent.click(screen.getByRole("button", { name: "Кредитна картка" }));
        fireEvent.change(screen.getByPlaceholderText("Назва, власник або останні 4 цифри…"), { target: { value: "4444" } });
        fireEvent.click(screen.getByText("TEST").closest("button"));
        expect(onChange).toHaveBeenCalledWith(card.id);
        fireEvent.click(screen.getByRole("button", { name: "Додати нову картку" }));
        fireEvent.change(screen.getByLabelText("Нікнейм"), { target: { value: "Test" } });
        fireEvent.change(screen.getByLabelText("Ім’я власника"), { target: { value: "Test Owner" } });
        fireEvent.change(screen.getByLabelText("Номер картки"), { target: { value: "5555555555554444" } });
        fireEvent.change(screen.getByLabelText("Строк MM/YY"), { target: { value: "09/28" } });
        fireEvent.change(screen.getByLabelText("CVV · необов’язково"), { target: { value: "073" } });
        fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(card));
        expect(onChange).toHaveBeenLastCalledWith(card.id);
        expect(screen.queryByText("Нова картка")).not.toBeInTheDocument();
    });

    it("ставить активні персональні РК першими без зміни вхідного списку", () => {
        const accounts = [
            { accountId: "1", accountStatus: 2 }, { accountId: "10", accountStatus: "1" },
            { accountId: "2", accountStatus: 1 }, { accountId: "3", accountStatus: 3 },
        ];
        expect(sortAdAccounts(accounts).map((item) => item.accountId)).toEqual(["2", "10", "1", "3"]);
        expect(accounts[0].accountId).toBe("1");
    });

    it("передає введений CVV та не підставляє збережений код у редактор", async () => {
        window.adsBot = {
            getCreditCards: vi.fn().mockResolvedValue({ ok: true, data: [card] }),
            updateCreditCard: vi.fn().mockResolvedValue({ ok: true, data: card }),
        };
        render(<CreditCardsSettings />);
        fireEvent.click(await screen.findByTitle("Редагувати"));
        const code = screen.getByLabelText("CVV · залиште порожнім, щоб не змінювати");
        expect(code).toHaveValue("");
        expect(code).toHaveAttribute("type", "password");
        fireEvent.change(code, { target: { value: "07" } });
        expect(screen.getByRole("button", { name: "Зберегти" })).toBeDisabled();
        fireEvent.change(code, { target: { value: "073" } });
        fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
        await waitFor(() => expect(window.adsBot.updateCreditCard).toHaveBeenCalledWith(card.id,
            expect.objectContaining({ securityCode: "073" })));
        await waitFor(() => expect(screen.queryByText("Редагувати картку")).not.toBeInTheDocument());
        fireEvent.click(screen.getByTitle("Редагувати"));
        fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
        await waitFor(() => expect(window.adsBot.updateCreditCard).toHaveBeenLastCalledWith(card.id,
            expect.objectContaining({ securityCode: "" })));
    });
});
