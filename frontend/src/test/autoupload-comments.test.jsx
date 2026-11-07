import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AutouploadTab from "../tabs/AutouploadTab.jsx";
import AutouploadCommentsModal from "../components/AutouploadCommentsModal.jsx";
import AutouploadActionDetails from "../components/AutouploadActionDetails.jsx";

const profiles = [{ profileId: "p1", profileNo: "12", name: "Profile", groupId: "new", status: "unchecked" }];
const url = "https://www.facebook.com/permalink.php?story_fbid=pfbidTest123&id=456";
beforeEach(() => {
    window.adsBot = {
        publishAutouploadComments: vi.fn(async () => ({ ok: true, data: { taskId: "comments-task" } })),
        getAutoupload: async () => ({ ok: true, data: { groups: [{ id: "new", name: "Нові" }], profiles, history: [] } }),
        onAutouploadUpdated: () => () => {},
    };
});
afterEach(() => { cleanup(); delete window.adsBot; });

it("дія у вкладці відкриває форму, показує чергу та передає нормалізовані коментарі", async () => {
    render(<AutouploadTab />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Вибрати профіль 12" }));
    fireEvent.click(screen.getByRole("button", { name: "Дії ▾" }));
    fireEvent.click(screen.getByRole("button", { name: "Написати коментарі" }));
    expect(screen.getByRole("button", { name: "Запустити чергу" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Посилання на пост"), { target: { value: url } });
    fireEvent.change(screen.getByLabelText(/^Коментарі/), { target: { value: " First\n\n Second \nFirst" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Запустити чергу" }));
    await waitFor(() => expect(window.adsBot.publishAutouploadComments).toHaveBeenCalledWith(["p1"], { postUrl: url, comments: ["First", "Second", "First"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("невідповідний URL блокує запуск; помилка IPC залишає введені дані", async () => {
    window.adsBot.publishAutouploadComments.mockResolvedValue({ ok: false, error: { message: "Черга зайнята" } });
    render(<AutouploadCommentsModal profiles={profiles} onClose={() => {}} onQueued={() => {}} />);
    fireEvent.change(screen.getByLabelText("Посилання на пост"), { target: { value: "https://example.com/" } });
    fireEvent.change(screen.getByLabelText(/^Коментарі/), { target: { value: "Test" } });
    expect(screen.getByRole("button", { name: "Запустити чергу" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Посилання на пост"), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "Запустити чергу" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Черга зайнята");
    expect(screen.getByLabelText(/^Коментарі/)).toHaveValue("Test");
});

it("результат показує ID та проблему лічильника без втрати успіху", () => {
    render(<AutouploadActionDetails entry={{ operation: "comment-create", success: true, commentId: "graphql-id", legacyCommentId: "123456", commentFeedbackId: "feedback-id", text: "Test", message: "Створено", counterWarning: "Лічильник не синхронізовано" }} />);
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByText("graphql-id")).toBeInTheDocument();
    expect(screen.getByText("Лічильник не синхронізовано")).toBeInTheDocument();
});

it("історія профілю називає операцію коментарем і показує його ID", async () => {
    const original = window.adsBot.getAutoupload;
    window.adsBot.getAutoupload = async () => {
        const value = await original();
        value.data.history = [{ id: "history1", profileId: "p1", profileNo: "12", operation: "comment-create", commentIndex: 2,
            commentId: "saved-graphql-id", success: true, message: "Створено", text: "Test" }];
        return value;
    };
    render(<AutouploadTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Деталі" }));
    expect(screen.getByRole("heading", { name: /Коментар 2/ })).toBeInTheDocument();
    expect(screen.getByText("saved-graphql-id")).toBeInTheDocument();
});
