import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PagePostDiscussion from "../components/PagePostDiscussion.jsx";

afterEach(cleanup);
const post = { id: "10_20", reactionCount: 12, commentCount: 30 };
const comment = (id, parentId = null) => ({ id, parentId, author: `Автор ${id}`, message: `Текст ${id}`, reactionCount: 3 });

it("показує типи реакцій окремо на пості, коментарі та відповіді", async () => {
    window.adsBot = { getPagePostComments: vi.fn().mockResolvedValue({ ok: true, data: {
        comments: [{ ...comment("1"), reactionCounts: { LIKE: 2, LOVE: 1 } },
            { ...comment("2", "1"), reactionCounts: { CARE: 1, ANGRY: 2 } }], nextCursor: null,
    } }) };
    render(<PagePostDiscussion accountKey="a" pageId="10" post={{ ...post,
        reactionCounts: { LIKE: 4, LOVE: 2, CARE: 1, HAHA: 1, WOW: 1, SAD: 1, ANGRY: 2 },
    }} />);
    const postReactions = screen.getByRole("group", { name: "Реакції" });
    for (const label of ["Подобається: 4", "Любов: 2", "Турбота: 1", "Ха-ха: 1", "Ого: 1", "Сум: 1", "Злість: 2"]) {
        expect(within(postReactions).getByLabelText(label)).toBeInTheDocument();
    }
    expect(window.adsBot.getPagePostComments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Розгорнути"));
    const first = (await screen.findByText("Текст 1")).closest(".page-post-comment");
    expect(within(first).getByLabelText("Подобається: 2")).toBeInTheDocument();
    expect(within(first).getByLabelText("Любов: 1")).toBeInTheDocument();
    const reply = screen.getByText("Текст 2").closest(".is-reply");
    expect(within(reply).getByLabelText("Турбота: 1")).toBeInTheDocument();
    expect(within(reply).getByLabelText("Злість: 2")).toBeInTheDocument();
});

it("не показує нульові реакції й підтримує старий кеш без розподілу", () => {
    const view = render(<PagePostDiscussion accountKey="a" pageId="10" post={{ ...post, reactionCounts: { LIKE: 12, LOVE: 0 } }} />);
    expect(screen.getByLabelText("Подобається: 12")).toBeInTheDocument();
    expect(screen.queryByLabelText("Любов: 0")).not.toBeInTheDocument();
    view.rerender(<PagePostDiscussion accountKey="a" pageId="10" post={post} />);
    expect(screen.getByText("12 реакцій")).toBeInTheDocument();
});

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
