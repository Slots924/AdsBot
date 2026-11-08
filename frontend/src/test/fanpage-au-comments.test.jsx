import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FanPageAuCommentsModal from "../components/FanPageAuCommentsModal.jsx";

afterEach(cleanup);
it("переносить налаштування, вибирає всі профілі та запускає лише залишені", async () => {
    const draft = { postUrl: "https://www.facebook.com/permalink.php?story_fbid=123&id=456", geo: "US", language: "", creativeName: "202", siteUrl: "https://example.com" };
    window.adsBot = {
        prepareFanPageAuComments: vi.fn(async () => ({ ok: true, data: { profiles: [
            { profileId: "a", profileNo: "1", name: "Олена", gender: "female" },
            { profileId: "b", profileNo: "2", name: "Іван", gender: "male" },
        ], prepared: { commentRows: [{ text: "Коментар", gender: "female" }] } } })),
        runFanPageAuComments: vi.fn(async () => ({ ok: true, data: { taskId: "task" } })),
    };
    const queued = vi.fn();
    render(<FanPageAuCommentsModal initialDraft={draft} countries={[]} onBack={vi.fn()} onClose={vi.fn()} onQueued={queued} />);
    expect(screen.getByDisplayValue(draft.postUrl)).toBeInTheDocument();
    expect(screen.getByDisplayValue("202")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Завантажити акаунти та коментарі"));
    await screen.findByText("№2 · Іван");
    expect(screen.getByLabelText("Вибрати всі акаунти")).toBeChecked();
    fireEvent.click(screen.getByText("№2 · Іван"));
    fireEvent.click(screen.getByText("Запустити AU Comments"));
    await waitFor(() => expect(queued).toHaveBeenCalledWith({ taskId: "task" }));
    expect(window.adsBot.runFanPageAuComments).toHaveBeenCalledWith({ ...draft, ids: ["a"] });
});
