import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import PhoneVerificationNotice from "../components/PhoneVerificationNotice.jsx";
import checkPhoneVerification from "../../../facebook/api-actions/phone-verification/checkPhoneVerification.js";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

// Відтворюємо окремий browser context без модульного require тестового середовища.
const page = { url: () => "https://adsmanager.facebook.com/adsmanager/",
    evaluate: (fn, args) => new Function("require", "args", `return (${fn.toString()})(args)`)(globalThis.require, args) };
function mockResponse(chunks, ok = true) {
    vi.stubGlobal("require", (name) => name === "DTSGInitialData" ? { token: "test-token" } : { USER_ID: "42" });
    const fetch = vi.fn().mockResolvedValue({ ok, text: async () => chunks.map((chunk) => JSON.stringify(chunk)).join("\n") });
    vi.stubGlobal("fetch", fetch);
    return fetch;
}
const responseWith = (completionStatus) => ({ data: { ad_account: {
    start_your_day_init_task_widgets: [{ taskType: "PHONE_NUMBER_VERIFICATION", completionStatus }],
} } });

describe("Перевірка телефонної задачі", () => {
    it.each([["INCOMPLETE", "NOT_LINKED"], ["COMPLETE", "LINKED"], ["OTHER", "UNKNOWN"]])(
        "%s повертає %s", async (status, expected) => {
            const fetch = mockResponse([responseWith(status), { data: {} }]);
            const result = await checkPhoneVerification({ page, adAccountId: "act_123" });
            expect(result.phoneStatus).toBe(expected);
            const [url, options] = fetch.mock.calls[0];
            expect(url).toBe("/api/graphql/");
            expect(options.credentials).toBe("include");
            expect(JSON.parse(new URLSearchParams(options.body).get("variables"))).toEqual({ adAccountID: "123" });
        }
    );
    it("відсутність задачі не означає прив'язаний телефон", async () => {
        mockResponse([{ data: { ad_account: { start_your_day_init_task_widgets: [] } } }]);
        expect((await checkPhoneVerification({ page, adAccountId: "123" })).phoneStatus).toBe("UNKNOWN");
    });
    it("GraphQL-помилка в deferred-блоці скасовує зелений результат", async () => {
        mockResponse([responseWith("COMPLETE"), { errors: [{ message: "Failed" }] }]);
        expect((await checkPhoneVerification({ page, adAccountId: "123" })).phoneStatus).toBe("UNKNOWN");
    });
    it("не надсилає запит з іншого домену", async () => {
        const evaluate = vi.fn();
        const result = await checkPhoneVerification({ page: { url: () => "https://www.facebook.com/", evaluate }, adAccountId: "123" });
        expect(result.phoneStatus).toBe("UNKNOWN");
        expect(evaluate).not.toHaveBeenCalled();
    });
    it("HTTP-помилка та пошкоджена відповідь дають невідомий стан", async () => {
        mockResponse([responseWith("COMPLETE")], false);
        expect((await checkPhoneVerification({ page, adAccountId: "123" })).phoneStatus).toBe("UNKNOWN");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "bad response" }));
        expect((await checkPhoneVerification({ page, adAccountId: "123" })).phoneStatus).toBe("UNKNOWN");
    });
});

describe("Плашка телефонної перевірки", () => {
    it("повернення на вкладку не показує прострочену плашку", () => {
        vi.useFakeTimers();
        const result = { phoneStatus: "LINKED", expiresAt: Date.now() + 5000 };
        const first = render(<PhoneVerificationNotice result={result} />);
        first.unmount();
        act(() => vi.advanceTimersByTime(5001));
        render(<PhoneVerificationNotice result={result} />);
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
    it("резервує місце, змінює колір і ховає результат через 5 секунд", () => {
        vi.useFakeTimers();
        const { rerender } = render(<PhoneVerificationNotice result={null} />);
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
        rerender(<PhoneVerificationNotice result={{ phoneStatus: "NOT_LINKED" }} />);
        expect(screen.getByText("Телефон не прив’язаний")).toHaveClass("red");
        act(() => vi.advanceTimersByTime(4000));
        rerender(<PhoneVerificationNotice result={{ phoneStatus: "LINKED" }} />);
        expect(screen.getByText("Телефон прив’язаний")).toHaveClass("green");
        act(() => vi.advanceTimersByTime(4999));
        expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
        rerender(<PhoneVerificationNotice result={{ phoneStatus: "UNKNOWN" }} />);
        expect(screen.getByText("Не вдалося з’ясувати")).toHaveClass("yellow");
    });
});
