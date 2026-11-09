import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ManualCommentsModal from "../components/ManualCommentsModal.jsx";
import { CommentModal } from "../tabs/PagesTab.jsx";

afterEach(cleanup);
const draft = { geo: "US", language: "", creativeName: "202", groupIds: ["g"], siteUrl: "" };
const comments = [
    { id: "1", text: "Перший учасник розпочинає діалог", gender: "male", profile_key: "a", parent_id: null, should_write: true, status: "pending" },
    { id: "2", text: "Другий учасник відповідає", gender: "male", profile_key: "b", parent_id: "1", should_write: true, status: "pending" },
    { id: "3", text: "Авторська відповідь", gender: null, is_author: true, parent_id: "1", should_write: false, status: "pending" },
];
const base = () => ({ id: "s1", settings: draft, comments: structuredClone(comments), assignments: {}, pool: [
    { profileNo: "12", name: "Перший акаунт", gender: "male", state: "available" },
    { profileNo: "13", name: "Другий акаунт", gender: "male", state: "available" },
] });
function mount(resume = base(), authorPageUrl = "") {
    let state = resume;
    const api = vi.fn(async (action, input) => {
        if (action === "start") state = { ...base(), settings: { ...draft, openAuthorPage: input.openAuthorPage } };
        if (action === "updateSettings") state.settings = { ...state.settings, openAuthorPage: input.openAuthorPage };
        if (action === "open") {
            state.comments.find((row) => row.id === input.commentId).status = "assumed";
            state.comments.find((row) => row.id === input.commentId).profileNo = "12";
            state.assignments.a = "12";
            state.pool[0].state = "assigned";
        }
        return { ok: true, data: structuredClone(state) };
    });
    window.adsBot = { manualCommentAction: api };
    const onClose = vi.fn();
    render(<ManualCommentsModal contextKey="context" authorPageUrl={authorPageUrl} initialDraft={draft} countries={[]} groups={[]}
        onClose={onClose} onBack={vi.fn()} />);
    return { api, onClose };
}

it("показує доступні акаунти, реплаї та неактивні кнопки автора", async () => {
    mount();
    await screen.findByText("Сценарій коментарів");
    expect(screen.getByRole("button", { name: "Доступні · 2" })).toBeInTheDocument();
    const author = screen.getByText("Авторська відповідь").closest("article");
    for (const button of within(author).getAllByRole("button").slice(1)) expect(button).toBeDisabled();
    expect(screen.getByText("Другий учасник відповідає").closest("article")).toHaveClass("mc-reply");
    fireEvent.click(screen.getByRole("button", { name: "Розгорнути коментар 1" }));
    expect(screen.getByRole("button", { name: "Розгорнути коментар 1" })).toHaveAttribute("aria-expanded", "true");
});

it("перемикач вимкнений за замовчуванням і доступний до та після підготовки", async () => {
    const authorPageUrl = "https://www.facebook.com/123";
    const { api } = mount(null, authorPageUrl);
    const toggle = await screen.findByRole("checkbox", { name: "Відкривати одразу сторінку автора" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Підтвердити" }));
    await screen.findByText("Сценарій коментарів");
    expect(api).toHaveBeenCalledWith("start", expect.objectContaining({ openAuthorPage: true, authorPageUrl }));
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(api).toHaveBeenCalledWith("updateSettings", expect.objectContaining({ sessionId: "s1", openAuthorPage: false, authorPageUrl }));
    fireEvent.click(screen.getByRole("button", { name: "Відкрити профіль для коментаря 1" }));
    await screen.findByText("Текст коментаря скопійовано");
    expect(api).toHaveBeenCalledWith("open", expect.objectContaining({ authorPageUrl, commentId: "1" }));
});

it("відновлює перемикач із сеансу та блокує його без адреси автора", async () => {
    const state = base();
    state.settings = { ...draft, openAuthorPage: true };
    mount(state);
    await screen.findByText("Сценарій коментарів");
    const toggle = screen.getByRole("checkbox", { name: "Відкривати одразу сторінку автора" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
});

it.each([{ id: "123" }, { pageId: "123" }])("бере адресу автора з фанпейджа %j без зміни контексту", async (page) => {
    const api = vi.fn(async () => ({ ok: true, data: null }));
    window.adsBot = { manualCommentAction: api };
    render(<CommentModal page={{ ...page, geo: "US", creativeName: "202" }} accountKey="client"
        countries={[]} groups={[]} settings={{}} onClose={vi.fn()} onQueued={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Вручну" }));
    const toggle = await screen.findByRole("checkbox", { name: "Відкривати одразу сторінку автора" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(api).toHaveBeenCalledWith("resume", {
        contextKey: JSON.stringify(["client", "123", "", "post"]), authorPageUrl: "https://www.facebook.com/123",
    });
});

it("блокує дії до збереження перемикача та показує помилку без зміни значення", async () => {
    const { api } = mount(base(), "https://www.facebook.com/123");
    const toggle = await screen.findByRole("checkbox", { name: "Відкривати одразу сторінку автора" });
    await waitFor(() => expect(toggle).toBeEnabled());
    let rejectUpdate;
    api.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectUpdate = reject; }));
    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("button", { name: "Відкрити профіль для коментаря 1" })).toBeDisabled();
    rejectUpdate(new Error("Не вдалося зберегти"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не вдалося зберегти");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
});

it("відкриває акаунт за конкретним коментарем і фіксує статистику при закритті", async () => {
    const { api, onClose } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Відкрити профіль для коментаря 1" }));
    await screen.findByText("Текст коментаря скопійовано");
    expect(api).toHaveBeenCalledWith("open", { contextKey: "context", sessionId: "s1", commentId: "1" });
    expect(screen.getByText("№12", { selector: ".mc-open" })).toBeInTheDocument();
    expect(api.mock.calls.some(([action]) => action === "finish")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Завершити й закрити" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.mock.calls.filter(([action]) => action === "finish")).toHaveLength(1);
});

it("налаштування підтверджуються без вимоги посилання на пост", async () => {
    const { api } = mount(null);
    const confirm = await screen.findByRole("button", { name: "Підтвердити" });
    fireEvent.click(confirm);
    await screen.findByText("Сценарій коментарів");
    expect(api).toHaveBeenCalledWith("start", expect.objectContaining({ geo: "US", creativeName: "202", groupIds: ["g"] }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("порожній пул показує кількість доступних без попереджень про нестачу", async () => {
    const state = base();
    state.pool = [];
    mount(state);
    await screen.findByText("Сценарій коментарів");
    expect(screen.getByRole("button", { name: "Доступні · 0" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("заміна недоступна для учасника з іншими зарахованими репліками", async () => {
    const state = base();
    state.comments.push({ ...state.comments[0], id: "4", parent_id: "2", text: "Той самий учасник", status: "assumed", profileNo: "12" });
    state.assignments.a = "12";
    mount(state);
    expect(await screen.findByRole("button", { name: "Замінити профіль для коментаря 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Бан профілю для коментаря 1" })).toBeEnabled();
});
