import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PagePostDiscussion from "../components/PagePostDiscussion.jsx";

afterEach(cleanup);
const post = { id: "10_20", reactionCount: 12, commentCount: 30 };
const comment = (id, parentId = null) => ({ id, parentId, author: `Автор ${id}`, message: `Текст ${id}`, reactionCount: 3 });

it("завантажує лише після розгортання та додає наступну порцію без дублів", async () => {
    window.adsBot = { getPagePostComments: vi.fn()
        .mockResolvedValueOnce({ ok: true, data: { comments: [comment("1"), comment("2", "1")], nextCursor: "next" } })
        .mockResolvedValueOnce({ ok: true, data: { comments: [comment("2", "1"), comment("3")], nextCursor: null } }) };
    render(<PagePostDiscussion accountKey="a" pageId="10" post={post} />);
    expect(screen.getByText("12 реакцій")).toBeInTheDocument();
    expect(screen.getByText("30 коментарів")).toBeInTheDocument();
    expect(window.adsBot.getPagePostComments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Розгорнути"));
    expect(await screen.findByText("Текст 2")).toBeInTheDocument();
    expect(screen.getByText("Текст 2").closest(".page-post-comment")).toHaveClass("is-reply");
    fireEvent.click(screen.getByText("Показати більше"));
    await screen.findByText("Текст 3");
    expect(screen.getAllByText("Текст 2")).toHaveLength(1);
    expect(window.adsBot.getPagePostComments).toHaveBeenLastCalledWith({ accountKey: "a", pageId: "10", postId: "10_20", after: "next" });
    expect(screen.queryByText("Показати більше")).not.toBeInTheDocument();
});

it("скидає обговорення після оновлення поста й ігнорує запізнілу відповідь", async () => {
    let finish;
    window.adsBot = { getPagePostComments: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
        .mockResolvedValue({ ok: true, data: { comments: [], nextCursor: null } }) };
    const view = render(<PagePostDiscussion accountKey="a" pageId="10" post={post} />);
    fireEvent.click(screen.getByText("Розгорнути"));
    view.rerender(<PagePostDiscussion accountKey="a" pageId="10" post={{ ...post, commentCount: 31 }} />);
    expect(screen.getByText("Розгорнути")).toHaveAttribute("aria-expanded", "false");
    await act(async () => finish({ ok: true, data: { comments: [comment("old")], nextCursor: "stale" } }));
    expect(window.adsBot.getPagePostComments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Розгорнути"));
    await screen.findByText("Коментарів поки немає");
    expect(screen.queryByText("Текст old")).not.toBeInTheDocument();
    await waitFor(() => expect(window.adsBot.getPagePostComments).toHaveBeenCalledTimes(2));
});

it("дозволяє повторити невдале завантаження", async () => {
    window.adsBot = { getPagePostComments: vi.fn().mockRejectedValueOnce(new Error("Помилка мережі"))
        .mockResolvedValueOnce({ ok: true, data: { comments: [comment("1")], nextCursor: null } }) };
    render(<PagePostDiscussion accountKey="a" pageId="10" post={post} />);
    fireEvent.click(screen.getByText("Розгорнути"));
    await screen.findByText("Помилка мережі");
    fireEvent.click(screen.getByText("Спробувати ще"));
    await screen.findByText("Текст 1");
});
