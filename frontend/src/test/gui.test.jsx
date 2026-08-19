import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../components/Sidebar.jsx";
import PublishTab from "../tabs/PublishTab.jsx";
import TemplatesTab from "../tabs/TemplatesTab.jsx";
import { findGroupForGeo } from "../lib/groups.js";


describe("GUI helpers", () => {
    beforeEach(() => {
        window.adsBot = {
            getFanPages: vi.fn(),
        };
    });

    afterEach(() => {
        cleanup();
    });

    it("знаходить першу групу за geo-маркером без урахування регістру", () => {
        const groups = [
            { groupId: "1", groupName: "[CZ] Czechia" },
            { groupId: "2", groupName: "Main [hu] group" },
            { groupId: "3", groupName: "[HU] second" },
        ];

        expect(findGroupForGeo(groups, " hu ")).toEqual(groups[1]);
        expect(findGroupForGeo(groups, "US")).toBeNull();
        expect(findGroupForGeo(groups, "bad")).toBeNull();
    });

    it("показує безпечні дані й статуси Facebook-акаунтів", () => {
        render(
            <Sidebar
                accounts={[
                    {
                        accountKey: "fp_hub",
                        name: "Zinaida",
                        facebookUserId: "615",
                        status: "active",
                        error: null,
                    },
                    {
                        accountKey: "broken",
                        name: "Broken",
                        facebookUserId: null,
                        status: "error",
                        error: { message: "Proxy unavailable" },
                    },
                ]}
                selectedAccountKey="fp_hub"
                loading={false}
                onSelect={vi.fn()}
                onRefresh={vi.fn()}
            />
        );

        expect(screen.getByText("fp_hub")).toBeInTheDocument();
        expect(screen.getByText("Zinaida")).toBeInTheDocument();
        expect(screen.getByText("Proxy unavailable")).toBeInTheDocument();
        expect(document.querySelector(".account-card.selected .status-dot.active"))
            .toBeInTheDocument();
    });

    it("показує зрозумілий empty state для фанпейджів", async () => {
        window.adsBot.getFanPages.mockResolvedValue({
            ok: true,
            data: [],
        });

        render(
            <PublishTab
                selectedAccount={{
                    accountKey: "fp_hub",
                    status: "active",
                }}
                onError={vi.fn()}
                onPostSuccess={vi.fn()}
                addLog={vi.fn()}
            />
        );

        expect(await screen.findByText(
            "Facebook не повернув жодної доступної для публікації фанпейджі."
        )).toBeInTheDocument();
    });

    it("відображає кількість отриманих фанпейджів", async () => {
        window.adsBot.getFanPages.mockResolvedValue({
            ok: true,
            data: [{ id: "page-1", name: "Test Page" }],
        });

        render(
            <PublishTab
                selectedAccount={{
                    accountKey: "fp_hub",
                    status: "active",
                }}
                onError={vi.fn()}
                onPostSuccess={vi.fn()}
                addLog={vi.fn()}
            />
        );

        expect(await screen.findByText("1 доступних фанпейджів"))
            .toBeInTheDocument();
    });

    it("створює та показує локальний шаблон", async () => {
        window.adsBot.getTemplates = vi.fn().mockResolvedValue({
            ok: true,
            data: [],
        });
        window.adsBot.createTemplate = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                id: 1,
                name: "AT Slot",
                pixel: "pixel-123",
                updatedAt: "2026-08-19T07:00:00.000Z",
            },
        });

        render(
            <TemplatesTab onError={vi.fn()} showToast={vi.fn()} />
        );

        expect(await screen.findByText("Шаблонів ще немає"))
            .toBeInTheDocument();
        fireEvent.click(screen.getByText("Створити шаблон"));
        fireEvent.change(screen.getByPlaceholderText("Наприклад, AT Slot"), {
            target: { value: "AT Slot" },
        });
        fireEvent.change(screen.getByPlaceholderText("Pixel ID або назва"), {
            target: { value: "pixel-123" },
        });
        fireEvent.submit(screen.getByText("Новий шаблон").closest("form"));

        expect(await screen.findByText("pixel-123")).toBeInTheDocument();
        expect(window.adsBot.createTemplate).toHaveBeenCalledWith({
            name: "AT Slot",
            pixel: "pixel-123",
        });
    });
});
