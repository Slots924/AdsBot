import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FanPageAuCommentsModal from "../components/FanPageAuCommentsModal.jsx";
import CommentDialogueReport from "../components/CommentDialogueReport.jsx";

afterEach(cleanup);
it("переносить налаштування, вибирає всі профілі та запускає лише залишені", async () => {
    const draft = { postUrl: "https://www.facebook.com/permalink.php?story_fbid=123&id=456", geo: "US", language: "", creativeName: "202", siteUrl: "https://example.com", groupIds: ["g1"] };
    window.adsBot = {
        prepareFanPageAuComments: vi.fn(async () => ({ ok: true, data: { profiles: [
            { profileId: "a", profileNo: "1", name: "Олена", gender: "female" },
            { profileId: "b", profileNo: "2", name: "Іван", gender: "male" },
        ], prepared: { commentRows: [{ text: "Коментар", gender: "female" }] } } })),
        runFanPageAuComments: vi.fn(async () => ({ ok: true, data: { taskId: "task" } })),
    };
    const queued = vi.fn();
    render(<FanPageAuCommentsModal initialDraft={draft} countries={[]} groups={[{ groupId: "g1", groupName: "Група 1" }, { groupId: "g2", groupName: "Група 2" }]} onBack={vi.fn()} onClose={vi.fn()} onQueued={queued} />);
    expect(screen.getByDisplayValue(draft.postUrl)).toBeInTheDocument();
    expect(screen.getByDisplayValue("202")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Завантажити акаунти та коментарі"));
    await screen.findByText("№2 · Іван");
    expect(screen.getByLabelText("Вибрати всі акаунти")).toBeChecked();
    fireEvent.click(screen.getByText("№2 · Іван"));
    fireEvent.click(screen.getByText("Запустити AU Comments"));
    await waitFor(() => expect(queued).toHaveBeenCalledWith({ taskId: "task" }));
    expect(window.adsBot.runFanPageAuComments).toHaveBeenCalledWith({ ...draft, ids: ["a"] });
    expect(window.adsBot.prepareFanPageAuComments).toHaveBeenCalledWith(draft);
    fireEvent.click(screen.getByRole("button", { name: "Акаунти для коментарів" }));
    fireEvent.click(screen.getByText("Група 1", { selector: "strong" }));
    expect(screen.getByText("Завантажити акаунти та коментарі")).toBeDisabled();
    expect(screen.getByText("Запустити AU Comments")).toBeDisabled();
    fireEvent.click(screen.getByText("Група 2"));
    fireEvent.click(screen.getByText("Завантажити акаунти та коментарі"));
    await waitFor(() => expect(window.adsBot.prepareFanPageAuComments).toHaveBeenLastCalledWith({ ...draft, groupIds: ["g2"] }));
});

it('показує вкладені реплаї, учасників і правило єдиної спроби', async () => {
    window.adsBot = { prepareFanPageAuComments: vi.fn(async () => ({ ok: true, data: { profiles: [], prepared: { commentRows: [
        { id: '1', parent_id: null, text: 'Початок діалогу', gender: 'male', profile_key: 'a' },
        { id: '2', parent_id: '1', text: 'Відповідь учасника', gender: 'female', profile_key: 'b' },
        { id: '3', parent_id: '2', text: 'Повернення першого', gender: 'male', profile_key: 'a' },
    ] } } })) };
    render(<FanPageAuCommentsModal initialDraft={{ groupIds: ['g'], postUrl: 'https://www.facebook.com/permalink.php?story_fbid=123', geo: 'US', language: '', creativeName: '202', siteUrl: '' }} countries={[]} groups={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Завантажити акаунти та коментарі'));
    const reply = await screen.findByText('Відповідь учасника');
    expect(reply.closest('ol')).toHaveClass('au-replies');
    expect(screen.getByText('Повернення першого').closest('li').textContent).toContain('Учасник a');
    expect(screen.getByText(/На реплай дається одна спроба/)).toBeInTheDocument();
    expect(screen.getByText(/Like, Love або Wow/)).toBeInTheDocument();
});

it('короткий звіт розрізняє невідомий результат і підтверджену публікацію', () => {
    render(<CommentDialogueReport result={{ summary: {}, summaryText: 'Коментарі: 1 · Реплаї: 0 · Невідомо: 1', rows: [
        { id: '1', parent_id: null, type: 'comment', profileNo: '2726', status: 'success', commentTarget: { commentUrl: 'https://www.facebook.com/comment' } },
        { id: '2', parent_id: '1', type: 'reply', profileNo: '2726', status: 'unknown', message: 'Відповідь не отримано' },
    ] }} />);
    expect(screen.getByRole('link', { name: 'Опубліковано' })).toHaveAttribute('href', 'https://www.facebook.com/comment');
    expect(screen.getByText('Результат невідомий')).toBeInTheDocument();
    expect(screen.getByText('2 / 1')).toBeInTheDocument();
    expect(screen.getByText('Відповідь не отримано')).toBeInTheDocument();
});
