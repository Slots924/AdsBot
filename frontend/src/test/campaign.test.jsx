import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CampaignCreationWizard
    from "../components/CampaignCreationWizard.jsx";


describe("Створення рекламної кампанії", () => {
    beforeEach(() => {
        window.adsBot = {
            getFanPages: vi.fn(),
            getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        };
    });

    afterEach(() => {
        cleanup();
    });

    it("перевіряє та створює lead-кампанію з безпечними дефолтами", async () => {
        window.adsBot.getTemplates = vi.fn().mockResolvedValue({
            ok: true,
            data: [{
                id: 1,
                name: "HU Leads",
                countryCodes: ["HU"],
            }],
        });
        window.adsBot.getFanPages.mockResolvedValue({
            ok: true,
            data: [{ id: "10", name: "Page" }],
        });
        window.adsBot.getCampaignPagePosts = vi.fn().mockResolvedValue({
            ok: true,
            data: [{
                id: "10_20",
                message: "Newest website post",
                createdTime: "2026-08-20T10:00:00.000Z",
                thumbnailUrl: "https://scontent.test.fbcdn.net/post.jpg",
                type: "added_photos",
            }],
        });
        window.adsBot.onCampaignCreationProgress = vi.fn(() => () => {});
        window.adsBot.preflightCampaignCreation = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                pageName: "Page",
                pixel: { id: "30", name: "Pixel" },
                currency: "USD",
                postId: "10_20",
                dsa: {
                    beneficiary: "Example Beneficiary LLC",
                    payor: "Example Payor LLC",
                    beneficiarySource: "meta-default",
                    payorSource: "meta-default",
                },
            },
        });
        window.adsBot.startCampaignCreation = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                jobId: "job-1",
                taskId: "task-1",
                task: {
                    id: "task-1",
                    name: "Campaign",
                    status: "queued",
                    waitingReason: null,
                    progress: { completed: 0, total: 13 },
                },
            },
        });

        render(
            <CampaignCreationWizard
                accountKey="client"
                adAccount={{
                    id: "act_1",
                    localName: "Ім’я 1",
                    currency: "USD",
                    timezoneName: "Europe/Kyiv",
                }}
                createPaused
                defaultPixelId="30"
                defaultUtm="utm_source=adsbot"
                lastPublishedPost={{
                    accountKey: "publishing-client",
                    pageId: "10",
                    postId: "10_20",
                }}
                onClose={vi.fn()}
                onSuccess={vi.fn()}
            />
        );

        expect(screen.getByPlaceholderText("HU Leads 20.08")).toBeInTheDocument();
        await screen.findByText("HU Leads");
        await waitFor(() => expect(window.adsBot.getCampaignPagePosts)
            .toHaveBeenCalledWith("client", "10", 10));
        const usePublishedButtons = screen.getAllByRole("button", {
            name: "Взяти з публікації",
        });
        fireEvent.click(usePublishedButtons[0]);
        fireEvent.click(usePublishedButtons[1]);
        expect(screen.getByLabelText("Пошук поста")).toHaveValue("10_20");
        fireEvent.change(screen.getByPlaceholderText("HU Leads 20.08"), {
            target: { value: "Campaign" },
        });
        expect(screen.getByAltText("Прев’ю поста")).toBeInTheDocument();
        expect(screen.getByText("Newest website post")).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText("Оновити пости"));
        await waitFor(() => expect(window.adsBot.getCampaignPagePosts.mock.calls.length)
            .toBeGreaterThanOrEqual(2));
        fireEvent.click(screen.getByLabelText("Оновити фанпейджі"));
        await waitFor(() => expect(window.adsBot.getFanPages.mock.calls.length)
            .toBeGreaterThanOrEqual(2));
        fireEvent.click(screen.getByText("Перевірити дані"));
        expect(await screen.findByText("Preflight пройдено")).toBeInTheDocument();
        expect(screen.getByText(/Example Beneficiary LLC/)).toBeInTheDocument();
        expect(screen.getByText(/Meta default/)).toBeInTheDocument();
        fireEvent.click(screen.getByText("Створити з campaign на паузі"));
        await waitFor(() => expect(window.adsBot.startCampaignCreation)
            .toHaveBeenCalled());
        expect(window.adsBot.startCampaignCreation.mock.calls[0][0])
            .toMatchObject({
                accountKey: "client",
                adAccountId: "act_1",
                templateId: 1,
                campaignName: "Campaign",
                pageId: "10",
                postId: "10_20",
                adSetCount: 5,
                dailyBudget: 5,
                createPaused: true,
                pixelId: "30",
                utm: "utm_source=adsbot",
            });
        expect(await screen.findByText(/Кампанію додано в чергу/))
            .toBeInTheDocument();
    });
});
