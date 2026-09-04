import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import KeitaroStreamTemplatesTab from "../tabs/KeitaroStreamTemplatesTab.jsx";


afterEach(cleanup);


describe("Масове застосування шаблону потоку", () => {
    it("блокує кнопку до завершення оновлення всіх потоків", async () => {
        let finish;
        const request = new Promise((resolve) => { finish = resolve; });
        window.adsBot = {
            getKeitaroStreamTemplates: vi.fn().mockResolvedValue({ ok: true, data: [{
                id: 4,
                name: "AT OFFERS",
                stream: { name: "AT OFFERS", landings: [], offers: [], filters: [], triggers: [] },
            }] }),
            applyKeitaroStreamTemplateToMatchingStreams: vi.fn().mockReturnValue(request),
        };
        const showToast = vi.fn();
        render(<KeitaroStreamTemplatesTab onError={vi.fn()} showToast={showToast} />);

        const button = await screen.findByRole("button", { name: "Застосувати до всіх потоків" });
        fireEvent.click(button);
        expect(window.adsBot.applyKeitaroStreamTemplateToMatchingStreams).toHaveBeenCalledWith(4);
        expect(screen.getByRole("button", { name: "Застосовуємо…" })).toBeDisabled();

        finish({ ok: true, data: { matched: 3, updated: 3, failed: 0 } });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith("Оновлено потоків: 3", "success"));
    });
});
