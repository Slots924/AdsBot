import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CommentPostModal from "../components/CommentPostModal.jsx";

afterEach(cleanup);

it("надсилає ручний список звичайним текстом і спільні налаштування коментування", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, data: { taskId: "task-1" } });
    window.adsBot = { getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }), runSelectedProfilesCommenting: run };
    const onQueued = vi.fn();
    render(<CommentPostModal profiles={[{ profileNo: "12", name: "Акаунт" }]}
        settings={{ commentBrowserMode: "headless", commentDisableImages: true, commentWorkerConcurrency: 3, commentWorkerProxyIds: { 1: "p1" } }}
        onClose={vi.fn()} onQueued={onQueued} onError={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Коментарі — кожен з нового рядка" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Посилання на Facebook-пост" }), { target: { value: "https://www.facebook.com/posts/1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Ввести коментарі вручну" }));
    expect(screen.getByRole("textbox", { name: "Креатив" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Коментарі — кожен з нового рядка" }), { target: { value: "перший комент\nце мій другий комент\nкоментую в третє" } });
    fireEvent.click(screen.getByRole("button", { name: "У чергу" }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0]).toMatchObject({
        profileNos: ["12"], manualMode: true,
        manualComments: "перший комент\nце мій другий комент\nкоментую в третє",
        browserMode: "headless", disableImages: true, commentWorkerConcurrency: 3, commentWorkerProxyIds: { 1: "p1" },
    });
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith({ taskId: "task-1" }));
});
