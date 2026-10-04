import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JournalTab from "../tabs/JournalTab.jsx";

beforeEach(() => {
    window.localStorage.clear?.();
    window.adsBot = {
        getLogScopes: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        getLogs: vi.fn().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } }),
        getProfileActivity: vi.fn().mockResolvedValue({ ok: true, data: {
            items: [{ profileNo: "mock-profile", isBanned: true, accountType: "api", adsPowerGroupName: "Тестова група", commentAccountSetupApiCount: 2, commentAccountSetupUiCount: 3 }],
            total: 1, totalPages: 1,
            comparison: {
                tasks: [{ key: "comment_task", label: "Комент-задачі, середнє" }],
                groups: [{ accountType: "api", bannedCount: 2, averages: { comment_task: 1.5 } }],
            },
        } }),
    };
});
afterEach(cleanup);

it("показує тільки останній тип, фільтрує акаунти та передає період порівняння", async () => {
    render(<JournalTab onError={vi.fn()} showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Статистика" }));
    await screen.findByText("mock-profile");
    const row = screen.getByText("mock-profile").closest("tr");
    expect(row).toHaveClass("profile-stat-banned");
    expect(within(row).getByText("Забанено")).not.toHaveAttribute("title");
    expect(within(row).getByText("Тестова група")).toBeInTheDocument();
    const headers = within(row.closest("table")).getAllByRole("columnheader").map((item) => item.textContent);
    expect(headers.indexOf("Група AdsPower")).toBe(headers.indexOf("Бан") - 1);
    expect(headers).toContain("Всього задач");
    expect(within(row).getByLabelText("Оформлено через API")).toBeInTheDocument();
    expect(within(row).queryByLabelText("Оформлено через UI")).not.toBeInTheDocument();
    expect(screen.getByText("1,5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Звичайні акаунти" }));
    await waitFor(() => expect(window.adsBot.getProfileActivity).toHaveBeenLastCalledWith(expect.objectContaining({ includedAccountTypes: ["ui", "api"], page: 1 })));
    fireEvent.change(screen.getByLabelText("Період бану"), { target: { value: "30" } });
    await waitFor(() => expect(window.adsBot.getProfileActivity).toHaveBeenLastCalledWith(expect.objectContaining({ comparisonDateFrom: expect.any(String), comparisonDateTo: expect.any(String) })));
    fireEvent.change(screen.getByLabelText("Період бану"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Від"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("До"), { target: { value: "2026-02-28" } });
    await waitFor(() => expect(window.adsBot.getProfileActivity).toHaveBeenLastCalledWith(expect.objectContaining({
        comparisonDateFrom: new Date("2026-02-01T00:00:00").toISOString(),
        comparisonDateTo: new Date("2026-02-28T23:59:59.999").toISOString(),
    })));
    fireEvent.change(screen.getByLabelText("Від"), { target: { value: "2026-03-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("не пізніше");
});
