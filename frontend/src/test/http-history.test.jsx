import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HttpHistoryTimeline from "../components/HttpHistoryTimeline.jsx";
import AutouploadActionDetails from "../components/AutouploadActionDetails.jsx";

afterEach(cleanup);

it("історія розкриває великі відповіді окремо і показує запити без відповіді", async () => {
    const events = [{ event: "request.started", requestId: "r1", request: { method: "POST", url: "/graphql" } },
        { event: "request.finished", requestId: "r1", action: "changeName", request: { method: "POST", url: "/graphql" }, response: { status: 200, body: { detail: "full-facebook-response" } } },
        { event: "request.started", requestId: "r2", action: "upload", request: { method: "POST", url: "/upload" } }];
    const { container } = render(<HttpHistoryTimeline events={events} />);
    expect(container.querySelectorAll("pre")).toHaveLength(0);
    const root = screen.getByText("Історія HTTP-запитів Facebook").closest("details");
    root.open = true;
    fireEvent(root, new Event("toggle"));
    await screen.findByText(/changeName/);
    expect(container.querySelectorAll("pre")).toHaveLength(0);
    expect(screen.getByText(/Відповідь не отримана/)).toBeInTheDocument();
    const request = screen.getByText(/changeName/).closest("details");
    request.open = true;
    fireEvent(request, new Event("toggle"));
    await waitFor(() => expect(container.querySelector("pre")).toHaveTextContent("full-facebook-response"));
    expect(container.querySelectorAll("details")).toHaveLength(3);
});

it("деталі дії відкривають пов'язаний файл та показують помилку відкриття", async () => {
    window.adsBot = { openLocalPath: vi.fn().mockResolvedValue({ ok: false, error: { message: "Файл недоступний" } }) };
    render(<AutouploadActionDetails entry={{ operation: "profile-name-change", httpHistory: { path: "history.jsonl", requestCount: 4 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Відкрити HTTP-історію Facebook" }));
    expect(window.adsBot.openLocalPath).toHaveBeenCalledWith("history.jsonl");
    await screen.findByText("Файл недоступний");
});
