import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreditCardsSettings from "../components/CreditCardsSettings.jsx";

afterEach(cleanup);

const card = {
    id: "card-test", nickname: "Test", cardholderName: "Test Owner", expiration: "09/28",
    postalCode: "", countryCode: "US", network: "MASTERCARD", displayNumber: "••••4444", hasSecurityCode: true,
};

describe("CVV у налаштуваннях карток", () => {
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
