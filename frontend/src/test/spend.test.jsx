import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SpendSettings from "../components/SpendSettings.jsx";
import SpendTab from "../tabs/SpendTab.jsx";


afterEach(cleanup);


describe("Спенд", () => {
    it("показує кампанії та запускає ручний збір", async () => {
        window.adsBot = {
            getSpendOverview: vi.fn().mockResolvedValue({ ok: true, data: {
                settings: { lastCollectionRunAt: null, lastExportRunAt: null },
                totals: { spend: 12.5, exported: 0, pending: 12.5 },
                totalsByCurrency: { USD: { spend: 12.5, exported: 0, pending: 12.5 } },
                campaigns: [{
                    campaignId: "meta-1",
                    name: "Campaign 1",
                    adAccountId: "act_1",
                    currency: "USD",
                    spend: 12.5,
                    lastDelta: 2.5,
                    keitaroCampaignId: null,
                    collectedAt: "2026-09-03T12:00:00.000Z",
                    status: "mapping-missing",
                }],
            } }),
            startSpendCollection: vi.fn().mockResolvedValue({ ok: true, data: { taskId: "1" } }),
            startSpendExport: vi.fn().mockResolvedValue({ ok: true, data: { taskId: "2" } }),
        };
        render(<SpendTab tasks={[]} />);
        expect(await screen.findByText("Campaign 1")).toBeInTheDocument();
        expect(screen.getAllByText("12,50 USD").length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole("button", { name: /Оновити з Meta/ }));
        await waitFor(() => expect(window.adsBot.startSpendCollection).toHaveBeenCalledOnce());
    });


    it("зберігає дату та інтервали в налаштуваннях", async () => {
        window.adsBot = {
            getSpendSettings: vi.fn().mockResolvedValue({ ok: true, data: {
                startDate: "2026-09-01",
                commissionPercent: 10,
                collectEnabled: false,
                collectIntervalMinutes: 60,
                exportEnabled: false,
                exportIntervalMinutes: 60,
                reconciliationDays: 5,
                keitaroGroupIds: [],
            } }),
            getKeitaroCampaignGroups: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            saveSpendSettings: vi.fn().mockImplementation((payload) => Promise.resolve({ ok: true, data: payload })),
        };
        render(<SpendSettings />);
        const date = await screen.findByLabelText("Початок відрахунку");
        fireEvent.change(date, { target: { value: "2026-09-02" } });
        fireEvent.change(screen.getByLabelText("Комісія до спенду, %"), { target: { value: "10" } });
        fireEvent.click(screen.getByRole("button", { name: "Зберегти налаштування спенду" }));
        await waitFor(() => expect(window.adsBot.saveSpendSettings).toHaveBeenCalledWith(
            expect.objectContaining({ startDate: "2026-09-02", commissionPercent: 10 })
        ));
    });
});
