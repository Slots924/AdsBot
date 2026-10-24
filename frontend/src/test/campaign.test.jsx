import {
    act,
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
            getKeitaroCampaignSettings: vi.fn().mockResolvedValue({
                ok: true,
                data: { pixels: [] },
            }),
        };
    });

    afterEach(() => {
        cleanup();
    });

    const postWizardProps = {
        accountKey: "client",
        adAccount: { id: "act_1", timezoneName: "Europe/Kyiv" },
        defaultPixelId: "99",
        sourcePage: { id: "10", name: "Page", geo: "DE" },
        sourcePost: { id: "10_20", message: "Post" },
        onClose: vi.fn(),
    };

    const setupPostWizard = () => {
        window.adsBot.getTemplates = vi.fn().mockResolvedValue({ ok: true, data: [
            { id: 1, name: "DE Leads" }, { id: 2, name: "HU Leads" },
        ] });
        window.adsBot.getFanPages.mockResolvedValue({ ok: true, data: [] });
        window.adsBot.onCampaignCreationProgress = vi.fn(() => () => {});
    };

    it("завантажує пікселі у фоні, підставляє GEO та вибирає перший піксель замість дефолтного", async () => {
        setupPostWizard();
        let resolvePixels;
        window.adsBot.getAdPixels = vi.fn(() => new Promise((resolve) => { resolvePixels = resolve; }));
        render(<CampaignCreationWizard {...postWizardProps} />);
        expect(screen.getByRole("combobox", { name: "Pixel" })).toBeDisabled();
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Шаблон" })).toBeEnabled());
        expect(screen.getByRole("combobox", { name: "Шаблон" })).toHaveValue("DE");
        fireEvent.focus(screen.getByRole("combobox", { name: "Шаблон" }));
        fireEvent.click(screen.getByRole("button", { name: "DE Leads" }));
        fireEvent.change(screen.getByLabelText("Ad sets"), { target: { value: "7" } });
        expect(screen.getByLabelText("Ad sets")).toHaveValue(7);
        expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeDisabled();
        await act(async () => resolvePixels({ ok: true, data: [{ id: "40", name: "First" }, { id: "99", name: "Default" }] }));
        expect(screen.getByRole("combobox", { name: "Pixel" })).toHaveValue("40");
        expect(screen.getByLabelText("UTM").value).toContain("pixel=40");
        expect(screen.getByRole("combobox", { name: "Шаблон" })).toHaveValue("DE Leads");
    });

    it("ігнорує запізнілий список іншого РК", async () => {
        setupPostWizard();
        let resolveOld;
        window.adsBot.getAdPixels = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
            .mockResolvedValueOnce({ ok: true, data: [{ id: "50", name: "New account" }] });
        const view = render(<CampaignCreationWizard {...postWizardProps} />);
        view.rerender(<CampaignCreationWizard {...postWizardProps} adAccount={{ ...postWizardProps.adAccount, id: "act_2" }} />);
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Pixel" })).toHaveValue("50"));
        await act(async () => resolveOld({ ok: true, data: [{ id: "40", name: "Old account" }] }));
        expect(screen.getByRole("combobox", { name: "Pixel" })).toHaveValue("50");
        expect(screen.queryByRole("option", { name: /Old account/ })).not.toBeInTheDocument();
    });

    it("показує помилку пікселів і дозволяє повторити завантаження", async () => {
        setupPostWizard();
        window.adsBot.getAdPixels = vi.fn().mockRejectedValueOnce(new Error("Немає доступу до пікселів"))
            .mockResolvedValueOnce({ ok: true, data: [] });
        render(<CampaignCreationWizard {...postWizardProps} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Немає доступу до пікселів");
        expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Оновити пікселі" }));
        expect(await screen.findByRole("option", { name: "У цьому РК немає пікселів" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Pixel" })).toBeDisabled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("формує мітки без токена для незбереженого пікселя після ручного вибору", async () => {
        window.adsBot.getTemplates = vi.fn().mockResolvedValue({ ok: true, data: [] });
        window.adsBot.getFanPages.mockResolvedValue({ ok: true, data: [] });
        window.adsBot.onCampaignCreationProgress = vi.fn(() => () => {});
        window.adsBot.getAdPixels = vi.fn().mockResolvedValue({
            ok: true,
            data: [
                { id: "30", name: "Saved pixel" },
                { id: "40", name: "Unsaved pixel" },
                { id: "50", name: "Another pixel" },
            ],
        });
        const savedUtm = "utm_source=saved&pixel=30&token=test-token";
        window.adsBot.getKeitaroCampaignSettings.mockResolvedValue({
            ok: true,
            data: { pixels: [{ pixelId: "30", token: "test-token", utm: savedUtm }] },
        });
        render(<CampaignCreationWizard
            accountKey="client"
            adAccount={{ id: "act_1", timezoneName: "Europe/Kyiv" }}
            defaultPixelId="30"
            defaultUtm="utm_source=default"
            sourcePage={{ id: "10", name: "Page", geo: "DE" }}
            sourcePost={{ id: "10_20", message: "Post" }}
            onClose={vi.fn()}
        />);
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Pixel" })).toBeEnabled());
        expect(window.adsBot.getAdPixels).toHaveBeenCalledWith("client", "act_1");
        expect(screen.queryByLabelText("Ввести Pixel і UTM вручну")).not.toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Pixel" })).toHaveValue("30");
        await waitFor(() => expect(screen.getByLabelText("UTM")).toHaveValue(savedUtm));

        const choosePixel = async (id) => {
            fireEvent.change(screen.getByRole("combobox", { name: "Pixel" }), { target: { value: id } });
        };
        await choosePixel("40");
        const expectedUtm = "utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&pixel=40&ad_name={{ad.name}}";
        expect(screen.getByLabelText("UTM")).toHaveValue(expectedUtm);
        await choosePixel("30");
        expect(screen.getByLabelText("UTM")).toHaveValue(savedUtm);
        await choosePixel("50");
        expect(screen.getByLabelText("UTM")).toHaveValue(expectedUtm.replace("pixel=40", "pixel=50"));
        fireEvent.change(screen.getByLabelText("UTM"), { target: { value: "utm_source=custom" } });
        expect(screen.getByLabelText("UTM")).toHaveValue("utm_source=custom");
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
        fireEvent.change(screen.getByLabelText("Шаблон"), {
            target: { value: "1" },
        });
        await waitFor(() => expect(window.adsBot.getCampaignPagePosts)
            .toHaveBeenCalledWith("client", "10", 5, false));
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
        const progressListener = window.adsBot.onCampaignCreationProgress.mock.calls[0][0];
        progressListener({ jobId: "job-1", stage: "failed", error: {
            message: "Підтвердіть акаунт в Ads Manager", code: "FACEBOOK_ACCOUNT_AUTH_REQUIRED",
            graphCode: 31, graphSubcode: 3858385, requestId: "request-auth-mock",
            actionRequired: "authenticate_account", stage: "ad",
        } });
        expect(await screen.findByText(/пройдіть запропоновану перевірку/)).toBeInTheDocument();
        expect(screen.getByText(/request-auth-mock/)).toBeInTheDocument();
    });
});
