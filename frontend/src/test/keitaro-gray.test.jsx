import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GrayAssetRow, GraySelect } from "../components/gray-ui/index.js";
import KeitaroGrayShowcase from "../design/KeitaroGrayShowcase.jsx";
import { groupKeitaroOffers } from "../lib/keitaro.js";

afterEach(() => cleanup());

describe("Keitaro Gray UI", () => {
    it("показує живий еталон дизайн-системи", () => {
        render(<KeitaroGrayShowcase />);

        expect(screen.getByRole("heading", { name: "Keitaro Gray UI" })).toBeInTheDocument();
        expect(screen.getByText("Канонічний стиль")).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "Додати офери" })).toBeInTheDocument();
    });

    it("дозволяє шукати й вибирати пункт GraySelect", () => {
        const onChange = vi.fn();
        render(<GraySelect items={[{ id: "all", name: "Усі" }, { id: "archive", name: "Archive" }]} value="all" onChange={onChange} ariaLabel="Група" />);

        const select = screen.getByRole("combobox", { name: "Група" });
        fireEvent.focus(select);
        fireEvent.change(select, { target: { value: "arch" } });
        fireEvent.click(screen.getByRole("option", { name: "Archive" }));

        expect(onChange).toHaveBeenCalledWith("archive");
        expect(screen.getAllByRole("combobox", { name: "Група" })).toHaveLength(1);
    });

    it("передає зміни стану картки офера", () => {
        const onEnabledChange = vi.fn();
        render(<GrayAssetRow name="Offer 1399" meta="ID 1399" enabled onEnabledChange={onEnabledChange} />);

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
