import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CampaignAdSets from "../components/CampaignAdSets.jsx";
import AdAccountsTab from "../tabs/AdAccountsTab.jsx";

const ok = (data) => Promise.resolve({ ok: true, data });
const account = { id: "act_1", accountId: "1", localName: "Кабінет", name: "Demo", status: "active", currency: "USD", timezoneName: "America/Los_Angeles", isFavorite: true };
const row = { id: "3", name: "Основний адсет", effectiveStatus: "ACTIVE", dailyBudget: "2000", spend: 12, leads: 2 };
const data = { cacheHit: true, adSets: [row], listUpdatedAt: "2026-11-06T10:00:00Z", statisticsUpdatedAt: "2026-11-06T10:00:00Z" };
const setup = () => {
    window.adsBot = {
        getCampaignAdSets: vi.fn(() => ok(data)), refreshCampaignAdSets: vi.fn((input) => ok({ ...data, manualRefreshAllowed: Boolean(input.manual) })),
        refreshCampaignAdSetStatistics: vi.fn(() => window.adsBot.getCampaignAdSets()),
        deleteAdSet: vi.fn(() => ok({ id: row.id, status: "DELETED", data: { ...data, adSets: [{ ...row, status: "DELETED", effectiveStatus: "DELETED", spend: null, leads: null }] } })),
        duplicateAdSet: vi.fn(() => ok({ taskId: "duplicate-task" })),
        setAdSetStatus: vi.fn((input) => ok({ id: input.adSetId, status: input.status, effectiveStatus: input.status })),
    };
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const refreshAdSets = async () => {
    const button = screen.getByRole("button", { name: "Оновити адсети" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
};
describe("Адсети кампанії", () => {
    it("показує rejected попри ACTIVE і не запускає статистику при відкритті", async () => {
        setup();
        const rejected = { ...data, adSets: [{ ...row, status: "ACTIVE", isRejected: true }] };
        window.adsBot.getCampaignAdSets.mockImplementation(() => ok(rejected));
        window.adsBot.refreshCampaignAdSets.mockImplementation(() => ok(rejected));
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" canWrite />);
        expect(await screen.findByText("Відхилено")).toHaveClass("rejected");
        expect(screen.getByRole("switch", { name: "Вимкнути адсет Основний адсет" })).toBeChecked();
        expect(window.adsBot.refreshCampaignAdSetStatistics).not.toHaveBeenCalled();
    });
    it("показує червоний лічильник активної кампанії та сірий призупиненої", async () => {
        setup();
        window.adsBot.getAdCampaigns = vi.fn(() => ok({ cacheHit: true, campaigns: [{ id: "2", name: "Активна", status: "ACTIVE", effectiveStatus: "ACTIVE", rejectedCount: 4 }, { id: "5", name: "Пауза", status: "PAUSED", effectiveStatus: "PAUSED", rejectedCount: 2 }, { id: "6", name: "Без помилок", effectiveStatus: "ACTIVE", rejectedCount: 0 }] }));
        render(<AdAccountsTab selectedAccount={{ accountKey: "client", status: "active" }} workspaceAccounts={[account]} selectedId="act_1" setSelectedId={() => {}} onError={vi.fn()} />);
        expect(await screen.findByLabelText("Відхилені адсети: 4")).not.toHaveClass("muted");
        expect(screen.getByLabelText("Відхилені адсети: 2")).toHaveClass("muted");
        expect(screen.queryByLabelText("Відхилені адсети: 0")).not.toBeInTheDocument();
    });
    it("одразу змінює положення перемикачів кампаній і не блокує інші рядки", async () => {
        setup();
        const campaigns = { cacheHit: true, campaigns: [{ id: "2", name: "Перша", status: "ACTIVE", effectiveStatus: "ACTIVE" }, { id: "5", name: "Друга", status: "PAUSED", effectiveStatus: "PAUSED" }] };
        window.adsBot.getAdCampaigns = vi.fn(() => ok(campaigns));
        const finish = [];
        window.adsBot.setAdCampaignStatus = vi.fn(() => new Promise((resolve) => finish.push(resolve)));
        render(<AdAccountsTab selectedAccount={{ accountKey: "client", status: "active" }} workspaceAccounts={[account]} selectedId="act_1" setSelectedId={() => {}} onError={vi.fn()} />);
        const first = await screen.findByRole("switch", { name: "Вимкнути кампанію Перша" });
        const second = screen.getByRole("switch", { name: "Увімкнути кампанію Друга" });
        fireEvent.click(first);
        expect(first).not.toBeChecked(); expect(first).toHaveClass("pending");
        fireEvent.click(second);
        expect(second).toBeChecked();
        await act(async () => { finish[0]({ ok: true, data: { status: "PAUSED" } }); finish[1]({ ok: false, error: { message: "Помилка" } }); });
        expect(first).toBeEnabled(); expect(second).not.toBeChecked(); expect(second).toBeEnabled();
    });
    it("одразу перемикає кілька адсетів і повертає попередній стан при помилці", async () => {
        setup();
        const two = { ...data, adSets: [{ ...row, status: "ACTIVE" }, { ...row, id: "4", name: "Другий", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" }] };
        window.adsBot.getCampaignAdSets.mockImplementation(() => ok(two));
        window.adsBot.refreshCampaignAdSets.mockImplementation(() => ok(two));
        const finish = [];
        window.adsBot.setAdSetStatus.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        const first = await screen.findByRole("switch", { name: "Вимкнути адсет Основний адсет" });
        const second = screen.getByRole("switch", { name: "Увімкнути адсет Другий" });
        fireEvent.click(first);
        expect(first).not.toBeChecked(); expect(first).toHaveClass("pending"); expect(first).toBeDisabled();
        expect(second).toBeEnabled();
        fireEvent.click(second);
        expect(second).toBeChecked(); expect(screen.getAllByLabelText("Оновлюється статус")).toHaveLength(2);
        await act(async () => finish[0]({ ok: true, data: { status: "PAUSED", effectiveStatus: "PAUSED" } }));
        expect(first).toBeEnabled(); expect(first).not.toHaveClass("pending");
        await act(async () => finish[1]({ ok: false, error: { message: "Помилка зміни стану" } }));
        expect(second).not.toBeChecked(); expect(second).toBeEnabled();
        expect(screen.getByText(/Помилка зміни стану/)).toBeInTheDocument();
    });
    it("закриває дублювання після додавання задачі й перечитує лише кеш за подією", async () => {
        setup();
        let updated;
        window.adsBot.onAdSetsUpdated = (callback) => { updated = callback; return () => {}; };
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        fireEvent.click(await screen.findByRole("button", { name: "Дублювати адсет Основний адсет" }));
        fireEvent.click(screen.getByRole("button", { name: "Дублювати" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByText(/Дублювання додано в чергу/)).toBeInTheDocument();
        window.adsBot.getCampaignAdSets.mockImplementation(() => ok({ ...data, adSets: [...data.adSets, { ...row, id: "4", name: "Нова копія" }] }));
        const refreshCount = window.adsBot.refreshCampaignAdSets.mock.calls.length;
        await act(async () => updated({ adAccountId: "act_1", campaignId: "2" }));
        expect(await screen.findByText("Нова копія")).toBeInTheDocument();
        expect(window.adsBot.refreshCampaignAdSets).toHaveBeenCalledTimes(refreshCount);
    });
    it("показує список до завершення статистики, зберігаючи старі показники", async () => {
        setup();
        let finish;
        window.adsBot.refreshCampaignAdSetStatistics.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        expect(await screen.findByText("Основний адсет")).toBeInTheDocument();
        expect(window.adsBot.refreshCampaignAdSetStatistics).not.toHaveBeenCalled();
        await refreshAdSets();
        await waitFor(() => expect(finish).toBeTypeOf("function"));
        expect(screen.getByText(/оновлюється/)).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        await act(async () => finish({ ok: true, data: { ...data, adSets: [{ ...row, leads: 7 }] } }));
        expect(screen.getByText("7")).toBeInTheDocument();
    });
    it("оновлює статистику після попередньої помилки її перевірки", async () => {
        setup();
        window.adsBot.refreshCampaignAdSets.mockImplementation((input) => ok({ ...data, manualRefreshAllowed: Boolean(input.manual), listError: null, refreshError: { code: "FACEBOOK_CAMPAIGN_LIST_INVALID", message: "Попередня помилка статистики" } }));
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        await refreshAdSets();
        await waitFor(() => expect(window.adsBot.refreshCampaignAdSetStatistics).toHaveBeenCalledTimes(1));
    });
    it("підтверджує видалення і не повертає видалений стан через запізнілу статистику", async () => {
        setup();
        let finish;
        window.adsBot.refreshCampaignAdSetStatistics.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        const button = await screen.findByRole("button", { name: "Видалити адсет Основний адсет" });
        await refreshAdSets();
        await waitFor(() => expect(finish).toBeTypeOf("function"));
        fireEvent.click(button);
        expect(window.adsBot.deleteAdSet).not.toHaveBeenCalled();
        confirm.mockReturnValue(true);
        fireEvent.click(button);
        expect(await screen.findByText("Видалено")).toBeInTheDocument();
        expect(window.adsBot.deleteAdSet).toHaveBeenCalledWith(expect.objectContaining({ adSetId: "3", campaignId: "2", adAccountId: "act_1" }));
        await act(async () => finish({ ok: true, data }));
        expect(screen.getByText("Видалено")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Дублювати адсет Основний адсет" })).not.toBeInTheDocument();
    });
    it("не змінює адсет у разі помилки видалення", async () => {
        setup();
        vi.spyOn(window, "confirm").mockReturnValue(true);
        window.adsBot.deleteAdSet.mockResolvedValue({ ok: false, error: { message: "Немає дозволу видаляти" } });
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        fireEvent.click(await screen.findByRole("button", { name: "Видалити адсет Основний адсет" }));
        expect(await screen.findByText(/Немає дозволу/)).toBeInTheDocument();
        expect(screen.getByText("Активний")).toBeInTheDocument();
    });
    it("зберігає видимі дані при помилці токена та відкриває діалог з активним перемикачем", async () => {
        setup();
        window.adsBot.refreshCampaignAdSets.mockRejectedValue(new Error("Токен недійсний"));
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        expect(await screen.findByText(/Токен недійсний/)).toBeInTheDocument();
        expect(screen.getByText("Основний адсет")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Дублювати адсет Основний адсет" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByRole("switch", { name: "Увімкнути адсети" })).toBeChecked();
        expect(within(dialog).getByLabelText("Бюджет на день / копія · USD")).toHaveValue(20);
        fireEvent.change(within(dialog).getByLabelText("Кількість копій"), { target: { value: "3" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Дублювати" }));
        await waitFor(() => expect(window.adsBot.duplicateAdSet).toHaveBeenCalledWith(expect.objectContaining({ count: 3, budget: 20, startTime: null, createActive: true })));
    });
    it("не запитує бюджет CBO і створює копії на паузі за вимкненого перемикача", async () => {
        setup();
        window.adsBot.getCampaignAdSets.mockImplementation(() => ok({ ...data, adSets: [{ ...row, campaignBudget: true }] }));
        window.adsBot.refreshCampaignAdSets.mockImplementation(window.adsBot.getCampaignAdSets);
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        fireEvent.click(await screen.findByRole("button", { name: "Дублювати адсет Основний адсет" }));
        expect(screen.queryByLabelText("Бюджет на день / копія · USD")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("switch", { name: "Увімкнути адсети" }));
        fireEvent.click(screen.getByRole("button", { name: "Дублювати" }));
        await waitFor(() => expect(window.adsBot.duplicateAdSet).toHaveBeenCalledWith(expect.objectContaining({ budget: null, createActive: false })));
    });
    it("завантажує й оновлює тільки розгорнуті кампанії", async () => {
        setup();
        const campaigns = { cacheHit: true, campaigns: [{ id: "2", name: "Перша", status: "ACTIVE", effectiveStatus: "ACTIVE" }, { id: "5", name: "Друга", status: "ACTIVE", effectiveStatus: "ACTIVE" }] };
        window.adsBot.getAdCampaigns = vi.fn(() => ok(campaigns));
        window.adsBot.refreshAdCampaignData = vi.fn(() => ok(campaigns));
        render(<AdAccountsTab selectedAccount={{ accountKey: "client", status: "active" }} workspaceAccounts={[account]} selectedId="act_1" setSelectedId={() => {}} onError={vi.fn()} />);
        const expand = await screen.findByRole("button", { name: "Розгорнути кампанію Перша" });
        expect(window.adsBot.refreshCampaignAdSets).not.toHaveBeenCalled();
        fireEvent.click(expand);
        await screen.findByText("Основний адсет");
        await waitFor(() => expect(window.adsBot.refreshCampaignAdSets).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole("button", { name: "Оновити", exact: true }));
        await waitFor(() => expect(window.adsBot.refreshAdCampaignData).toHaveBeenCalledTimes(1));
        expect(window.adsBot.refreshCampaignAdSets).toHaveBeenCalledTimes(1);
        await refreshAdSets();
        await waitFor(() => expect(window.adsBot.refreshCampaignAdSets).toHaveBeenCalledTimes(2));
        expect(window.adsBot.refreshCampaignAdSets.mock.calls.every(([input]) => input.campaignId === "2")).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Згорнути кампанію Перша" }));
        expect(screen.queryByText("Основний адсет")).not.toBeInTheDocument();
    });
    it("читає бюджет на весь термін за нульового денного бюджету", async () => {
        setup();
        window.adsBot.getCampaignAdSets.mockImplementation(() => ok({ ...data, adSets: [{ ...row, dailyBudget: "0", lifetimeBudget: "5000" }] }));
        window.adsBot.refreshCampaignAdSets.mockImplementation(window.adsBot.getCampaignAdSets);
        render(<CampaignAdSets campaignId="2" accountKey="client" account={account} datePreset="today" refreshToken={0} canWrite />);
        fireEvent.click(await screen.findByRole("button", { name: "Дублювати адсет Основний адсет" }));
        expect(screen.getByLabelText("Бюджет на весь термін / копія · USD")).toHaveValue(50);
    });
});
