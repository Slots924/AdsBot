import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar.jsx";

afterEach(cleanup);

it.each(["api", "bm"])("оновлює токен %s окремою кнопкою праворуч від синхронізації", async (kind) => {
    const onRefreshAccessToken = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(<Sidebar standalone accounts={[{ accountKey: "test", kind, name: "Test", hasCookie: true, hasUserAgent: true }]}
        onRefreshAccessToken={onRefreshAccessToken} onSelect={onSelect} onError={vi.fn()} />);
    if (kind === "bm") fireEvent.click(screen.getByRole("radio", { name: "BM" }));
    const button = screen.getByRole("button", { name: "Оновити access token" });
    expect(button.previousElementSibling).toHaveAttribute("title", "Додайте номер профілю AdsPower");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onRefreshAccessToken).toHaveBeenCalledWith("test"));
    expect(onSelect).not.toHaveBeenCalled();
});

it("блокує повторне оновлення токена під час запиту", () => {
    render(<Sidebar accounts={[{ accountKey: "test", kind: "api", hasCookie: true, hasUserAgent: true }]}
        refreshingTokenAccountKeys={["test"]} onError={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Оновити access token" })).toBeDisabled();
});
