import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UiAssetRow, UiSelect } from "../components/shared-ui/index.js";
import { groupKeitaroOffers } from "../lib/keitaro.js";

afterEach(() => cleanup());

describe("Shared UI", () => {
    it("дозволяє шукати й вибирати пункт UiSelect", () => {
        const onChange = vi.fn();
        render(<UiSelect items={[{ id: "all", name: "Усі" }, { id: "archive", name: "Archive" }]} value="all" onChange={onChange} ariaLabel="Група" />);

        const select = screen.getByRole("combobox", { name: "Група" });
        fireEvent.focus(select);
        fireEvent.change(select, { target: { value: "arch" } });
        fireEvent.click(screen.getByRole("option", { name: "Archive" }));

        expect(onChange).toHaveBeenCalledWith("archive");
        expect(screen.getAllByRole("combobox", { name: "Група" })).toHaveLength(1);
    });

    it("передає зміни стану картки офера", () => {
        const onEnabledChange = vi.fn();
        render(<UiAssetRow name="Offer 1399" meta="ID 1399" enabled onEnabledChange={onEnabledChange} />);

        fireEvent.click(screen.getByRole("button", { name: "Вимк." }));

        expect(onEnabledChange).toHaveBeenCalledWith(false);
    });

    it("показує ID найстаршого офера у згрупованому офері", () => {
        const [group] = groupKeitaroOffers([
            { id: "72", name: "ZA | [Gentlove] | 151mf_mob", groupId: "36", affiliateNetworkId: "8" },
            { id: "71", name: "ZA | [Gentlove] | Default", groupId: "36", affiliateNetworkId: "8" },
        ]);

        expect(group.id).toBe("71");
        expect(group.sourceIds).toEqual(["72", "71"]);
    });
});
