import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../components/Sidebar.jsx";
import { findGroupForGeo } from "../lib/groups.js";


describe("GUI helpers", () => {
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
});
