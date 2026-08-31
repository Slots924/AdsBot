import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GrayAssetRow, GraySelect } from "../components/gray-ui/index.js";
import KeitaroGrayShowcase from "../design/KeitaroGrayShowcase.jsx";

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

        fireEvent.click(screen.getByRole("button", { name: "Група" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Пошук: Група" }), { target: { value: "arch" } });
        fireEvent.click(screen.getByRole("option", { name: "Archive" }));

        expect(onChange).toHaveBeenCalledWith("archive");
    });

    it("передає зміни стану картки офера", () => {
        const onEnabledChange = vi.fn();
        render(<GrayAssetRow name="Offer 1399" meta="ID 1399" enabled onEnabledChange={onEnabledChange} />);

        fireEvent.click(screen.getByRole("button", { name: "Вимк." }));

        expect(onEnabledChange).toHaveBeenCalledWith(false);
    });
});
