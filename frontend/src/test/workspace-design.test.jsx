import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreativeLaunchModal from "../components/CreativeLaunchModal.jsx";
import PagesTab from "../tabs/PagesTab.jsx";


const settings = {
    createCampaignsPaused: true,
    commentWorkerConcurrency: 5,
    commentBrowserMode: "visible",
    commentDisableImages: false,
    defaultPixelId: "30",
    defaultUtm: "utm_source=adsbot",
};


describe("Дизайн workspace фанпейджів", () => {
    beforeEach(() => {
        window.adsBot = {
            getCountries: vi.fn().mockResolvedValue({
                ok: true,
                data: [
                    { code: "DE", name: "Germany" },
                    { code: "UK", name: "United Kingdom" },
                ],
            }),
            getPagePostsWithLinks: vi.fn().mockResolvedValue({
                ok: true,
                data: [{
                    id: "10_20",
                    message: "Post",
                    permalinkUrl: "https://facebook.test/post",
                    createdTime: "2026-08-20T10:00:00.000Z",
                }],
            }),
            getAdAccounts: vi.fn().mockResolvedValue({
                ok: true,
                data: [
                    { id: "act_2", localName: "Disabled name", status: "disabled" },
                    { id: "act_1", localName: "Active name", status: "active" },
                ],
            }),
        };
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    afterEach(() => cleanup());

    it("показує GEO, креатив і копіювання безпосередньо на картці", async () => {
        render(
            <PagesTab
                selectedAccount={{ accountKey: "client", status: "active" }}
                pages={[{
                    id: "10",
                    name: "Deutschland Page",
                    geo: "DE",
                    creativeName: "1",
                    isFavorite: true,
                }]}
                adAccounts={[]}
                groups={[]}
                selectedPageId="10"
                setSelectedPageId={vi.fn()}
                onPagesChange={vi.fn()}
                onRefresh={vi.fn()}
                settings={settings}
                onError={vi.fn()}
                showToast={vi.fn()}
            />
        );

        expect(screen.getAllByText("DE").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Creo_1").length).toBeGreaterThan(0);
        expect(screen.getByTitle("Копіювати назву фанпейджі")).toBeInTheDocument();
        expect(screen.getByTitle("Копіювати ID фанпейджі")).toBeInTheDocument();
        expect(screen.getByTitle("Копіювати Page ID")).toBeInTheDocument();
        expect(await screen.findByText("Post")).toBeInTheDocument();
    });

    it("сортує рекламні акаунти за статусом і показує лише ID", async () => {
        render(
            <PagesTab
                selectedAccount={{ accountKey: "client", status: "active" }}
                pages={[{
                    id: "10",
                    name: "Deutschland Page",
                    geo: "DE",
                    creativeName: "1",
                    isFavorite: true,
                }]}
                adAccounts={[]}
                groups={[]}
                selectedPageId="10"
                setSelectedPageId={vi.fn()}
                onPagesChange={vi.fn()}
                onRefresh={vi.fn()}
                settings={settings}
                onError={vi.fn()}
                showToast={vi.fn()}
            />
        );

        fireEvent.click(await screen.findByRole("button", { name: "Кампанія" }));
        expect(await screen.findByText("Оберіть рекламний акаунт")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Рекламний акаунт" }));
        const options = within(document.querySelector(".campaign-account-modal .select-options"))
            .getAllByRole("button");
        expect(options[0]).toHaveTextContent("act_1");
        expect(options[1]).toHaveTextContent("act_2");
        expect(screen.queryByText("Active name")).not.toBeInTheDocument();
        expect(screen.queryByText("Disabled name")).not.toBeInTheDocument();
    });
});


describe("Вікно запуску креатива", () => {
    beforeEach(() => {
        window.adsBot = {
            getTemplates: vi.fn().mockResolvedValue({
                ok: true,
                data: [
                    { id: 2, name: "Zulu", ageMin: 40 },
                    { id: 1, name: "Alpha", ageMin: 25 },
                ],
            }),
            getCountries: vi.fn().mockResolvedValue({
                ok: true,
                data: [{ code: "DE", name: "Germany" }],
            }),
            getAdAccounts: vi.fn().mockResolvedValue({
                ok: true,
                data: [
                    { id: "act_2", status: "disabled", timezoneName: "Europe/Berlin" },
                    { id: "act_1", status: "active", timezoneName: "Europe/Berlin" },
                ],
            }),
            selectImage: vi.fn(),
            getDroppedFilePath: vi.fn(),
        };
    });

    afterEach(() => cleanup());

    it("використовує заголовок кампанії, автогрупу й пошукові контролі", async () => {
        render(
            <CreativeLaunchModal
                accountKey="client"
                page={{ id: "10", geo: "DE", creativeName: "1" }}
                adAccounts={[]}
                groups={[
                    { groupId: "de-group", groupName: "Main [DE]" },
                    { groupId: "uk-group", groupName: "Main [UK]" },
                ]}
                settings={settings}
                onClose={vi.fn()}
                onQueued={vi.fn()}
                onError={vi.fn()}
            />
        );

        expect(await screen.findByRole("heading", {
            name: "DE | Creo_1 | 25+",
        })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Акаунти для коментарів" }))
            .toHaveTextContent("Вибрано: 1");
        expect(screen.getByText("Перетягніть картинку сюди")).toBeInTheDocument();
        expect(screen.queryByText(/Pixel не задано/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByTitle("Змінити назву"));
        fireEvent.change(screen.getByLabelText("Назва кампанії"), {
            target: { value: "Моя кампанія" },
        });
        expect(screen.getByDisplayValue("Моя кампанія")).toBeInTheDocument();
        fireEvent.click(screen.getByTitle("Повернути автоматичну назву"));
        expect(screen.getByRole("heading", { name: "DE | Creo_1 | 25+" }))
            .toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Рекламний акаунт" }));
        await waitFor(() => {
            const options = within(document.querySelector(
                ".creative-launch-modal .ad-account-select .select-options"
            )).getAllByRole("button");
            expect(options[0]).toHaveTextContent("act_1");
            expect(options[1]).toHaveTextContent("act_2");
        });
    });
});
