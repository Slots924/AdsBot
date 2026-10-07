import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { campaignField, customKeitaroMetrics, keitaroColumns, sortKeitaroCampaigns, summarizeKeitaroRows } from "../lib/keitaro.js";
import KeitaroTab from "../tabs/KeitaroTab.jsx";
import { defaultKeitaroColumnWidths, keitaroColumnIds, keitaroReportMetrics } from "../../../services/keitaro/reportColumns.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Кастомні показники кампаній Keitaro", () => {
    it("обчислює формули, зокрема для числових рядків і нульових лідів", () => {
        expect(customKeitaroMetrics({ revenue: "120", leads: "4", conversions: "10", cost: "100" }))
            .toEqual({ fullRevenue: 300, fullProfit: 200, rawCost: 90.9 });
        expect(customKeitaroMetrics({ revenue: 120, leads: 0, conversions: 10, cost: 100 }))
            .toEqual({ fullRevenue: 0, fullProfit: -100, rawCost: 90.9 });
        expect(customKeitaroMetrics()).toEqual({ fullRevenue: 0, fullProfit: 0, rawCost: 0 });
    });

    it("сортує за обчисленими значеннями та підсумовує окремі кампанії", () => {
        const rows = [
            { id: "1", revenue: 120, leads: 4, conversions: 10, cost: 100 },
            { id: "2", revenue: 200, leads: 2, conversions: 3, cost: 40 },
        ];
        expect(campaignField(rows[0], "fullRevenue")).toBe(300);
        expect(sortKeitaroCampaigns(rows, { column: "fullProfit", direction: "desc" }).map((row) => row.id)).toEqual(["2", "1"]);
        expect(sortKeitaroCampaigns(rows, { column: "rawCost", direction: "asc" }).map((row) => row.id)).toEqual(["2", "1"]);
        expect(summarizeKeitaroRows(rows)).toMatchObject({ fullRevenue: 600, fullProfit: 460, rawCost: 127.26 });
        expect(summarizeKeitaroRows([rows[0]])).toMatchObject({ fullRevenue: 300, fullProfit: 200 });
        expect(summarizeKeitaroRows([])).toMatchObject({ fullRevenue: 0, fullProfit: 0, rawCost: 0 });
    });

    it("дозволяє додати кастомні колонки через шестерню та зберігати їхні налаштування", () => {
        const pending = () => new Promise(() => {});
        vi.stubGlobal("adsBot", { getKeitaroCampaignGroups: pending, getKeitaroCampaignsList: pending });
        const onVisibleColumnsChange = vi.fn();
        render(<KeitaroTab onVisibleColumnsChange={onVisibleColumnsChange} />);
        fireEvent.click(screen.getByRole("button", { name: "Колонки таблиці" }));
        expect(screen.getByText("Кастомні показники")).toBeInTheDocument();
        for (const column of keitaroColumns.filter((item) => item.custom)) {
            fireEvent.click(screen.getByRole("checkbox", { name: column.label }));
            expect(onVisibleColumnsChange).toHaveBeenLastCalledWith(["id", "name", "clicks", "conversions", "revenue", column.id]);
            expect(keitaroColumnIds).toContain(column.id);
            expect(defaultKeitaroColumnWidths[column.id]).toBe(column.width);
            expect(keitaroReportMetrics).not.toContain(column.id);
        }
    });
});
