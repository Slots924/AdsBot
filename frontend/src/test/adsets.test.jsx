import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CampaignAdSets from "../components/CampaignAdSets.jsx";
import AdAccountsTab from "../tabs/AdAccountsTab.jsx";

const ok = (data) => Promise.resolve({ ok: true, data });
const account = { id: "act_1", accountId: "1", localName: "Кабінет", name: "Demo", status: "active", currency: "USD", timezoneName: "America/Los_Angeles", isFavorite: true };
const row = { id: "3", name: "Основний адсет", effectiveStatus: "ACTIVE", dailyBudget: "2000", spend: 12, leads: 2 };
const data = { cacheHit: true, adSets: [row], listUpdatedAt: "2026-11-06T10:00:00Z", statisticsUpdatedAt: "2026-11-06T10:00:00Z" };
const setup = () => {
    window.adsBot = {
        getCampaignAdSets: vi.fn(() => ok(data)), refreshCampaignAdSets: vi.fn(() => ok(data)),
        duplicateAdSet: vi.fn(() => ok({ copies: [{ id: "4" }] })),
    };
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Адсети кампанії", () => {
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
        fireEvent.click(screen.getByRole("switch"));
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
        fireEvent.click(screen.getByRole("button", { name: "Оновити" }));
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
