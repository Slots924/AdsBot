import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PersonalPaymentSources from "../components/PersonalPaymentSources.jsx";
import { addCardAndRefreshSources } from "../lib/personalPaymentSources.js";
import getAdAccountPaymentSources from "../../../facebook/api-actions/ads-manager/getAdAccountPaymentSources.js";
import getAdAccountBusinessInfo from "../../../facebook/api-actions/ads-manager/getAdAccountBusinessInfo.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source = { id: "source-1", network: "Mastercard", last4: "2124", displayString: "Mastercard *2124" };
const page = { evaluate: (fn, args) => fn(args) };
const input = { page, accessToken: "mock-token", adAccountId: "123" };
const mockGraph = (body, ok = true) => {
    const fetch = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: async () => body });
    vi.stubGlobal("fetch", fetch);
    return fetch;
};

describe("Стани способів оплати", () => {
    it("розрізняє неперевірений стан, порожню відповідь і отриманий спосіб оплати", () => {
        const { rerender, container } = render(<PersonalPaymentSources result={null} />);
        expect(container.firstChild).toHaveAttribute("data-state", "unchecked");
        expect(screen.getByRole("status")).toHaveTextContent("Дані ще не перевірено");
        rerender(<PersonalPaymentSources result={{ sources: [], accountStatus: 2 }} />);
        expect(container.firstChild).toHaveAttribute("data-state", "empty");
        expect(screen.getByRole("status")).toHaveTextContent("Meta не повернула спосіб оплати");
        expect(screen.getByText(/Рекламний акаунт неактивний/)).toBeInTheDocument();
        rerender(<PersonalPaymentSources result={{ sources: [source], accountStatus: 1 }} />);
        expect(container.firstChild).toHaveAttribute("data-state", "present");
        expect(screen.getByText("•••• 2124")).toBeInTheDocument();
    });
    it("показує кілька джерел та зберігає попередні дані при помилці перевірки", () => {
        render(<PersonalPaymentSources result={{ sources: [source, { ...source, id: "source-2", last4: "5678" }] }} error="Немає доступу" />);
        expect(screen.getAllByRole("article")).toHaveLength(2);
        expect(screen.getByText("•••• 5678")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("результат попередньої перевірки");
    });
});

describe("Браузерне читання Graph API", () => {
    it("отримує масковану карту через браузер і не додає expired-джерело до списку", async () => {
        const fetch = mockGraph({ id: "act_123", account_status: 1, funding_source_details: { id: "source-1", display_string: "Mastercard *2124", type: 1 }, expired_funding_source_details: { id: "old" } });
        const result = await getAdAccountPaymentSources(input);
        expect(result.success).toBe(true);
        expect(result.data.sources).toEqual([{ ...source, type: 1 }]);
        expect(fetch.mock.calls[0][0]).toContain("/v26.0/act_123?");
        expect(fetch.mock.calls[0][1].credentials).toBe("include");
    });
    it("приймає успішну порожню відповідь для неактивного РК", async () => {
        mockGraph({ id: "act_123", account_status: 2 });
        const result = await getAdAccountPaymentSources(input);
        expect(result.success).toBe(true);
        expect(result.data.sources).toEqual([]);
        expect(result.data.accountStatus).toBe(2);
    });
    it("повертає помилку API, не перетворюючи її на порожній список", async () => {
        mockGraph({ error: { message: "Permission denied", code: 200 } }, false);
        const result = await getAdAccountPaymentSources(input);
        expect(result.success).toBe(false);
        expect(result.graphCode).toBe(200);
        expect(result.data).toBeUndefined();
    });
    it("не вважає пошкоджену відповідь успішною перевіркою", async () => {
        mockGraph(null);
        expect((await getAdAccountPaymentSources(input)).success).toBe(false);
    });
    it("зберігає нормалізацію бізнес-інфи після перевикористання браузерного запиту", async () => {
        const fetch = mockGraph({ id: "act_123", currency: "USD", timezone_name: "Europe/Kiev", business_country_code: "US", business_city: "Washington" });
        const result = await getAdAccountBusinessInfo(input);
        expect(result.data).toMatchObject({ adAccountId: "123", currency: "USD", timezone: "Europe/Kiev", countryCode: "US", city: "Washington", street1: "" });
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe("Перевірка після додавання карти", () => {
    it("перевіряє джерела після успіху і зберігає результат додавання при помилці перевірки", async () => {
        const events = [];
        const result = await addCardAndRefreshSources({
            addCard: async () => { events.push("add"); return { added: true }; },
            refreshSources: async () => { events.push("refresh"); throw new Error("Read failed"); },
        });
        expect(events).toEqual(["add", "refresh"]);
        expect(result).toEqual({ added: true });
    });
    it("перевіряє джерела після відмови додавання та зберігає оригінальну помилку", async () => {
        const refreshSources = vi.fn().mockRejectedValue(new Error("Read failed"));
        const error = new Error("Card rejected");
        await expect(addCardAndRefreshSources({ addCard: async () => { throw error; }, refreshSources })).rejects.toBe(error);
        expect(refreshSources).toHaveBeenCalledOnce();
    });
});
