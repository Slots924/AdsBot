import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../components/Sidebar.jsx";
import PublishTab from "../tabs/PublishTab.jsx";
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
});
