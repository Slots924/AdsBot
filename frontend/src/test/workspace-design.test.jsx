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
import GeoSelect from "../components/GeoSelect.jsx";
import PagesTab from "../tabs/PagesTab.jsx";


const settings = {
    createCampaignsPaused: true,
    commentWorkerConcurrency: 5,
    commentBrowserMode: "visible",
    commentDisableImages: false,
    commentWorkerProxyIds: { 1: "proxy-1" },
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
                    { code: "HU", name: "Hungary" },
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
                    thumbnailUrl: `adsbot-cache://image/${"a".repeat(64)}.jpg`,
                }],
            }),
            getPagePostsSignature: vi.fn().mockResolvedValue({
                ok: true,
                data: { count: 1, postIds: ["10_20"] },
            }),
            refreshSelectedFanPage: vi.fn().mockResolvedValue({
                ok: true,
                data: {
                    page: {
                        id: "10",
                        name: "Deutschland Page Updated",
                        pictureUrl: "data:image/png;base64,AA==",
                    },
                    posts: [{
                        id: "10_21",
                        message: "Updated post",
                        permalinkUrl: "https://facebook.test/updated",
                        createdTime: "2026-08-21T10:00:00.000Z",
                        thumbnailUrl: "data:image/png;base64,AA==",
                    }],
                    postCount: 1,
                },
            }),
            writeRendererLog: vi.fn().mockResolvedValue({ ok: true }),
            getAdAccounts: vi.fn().mockResolvedValue({
                ok: true,
                data: [
                    { id: "act_2", localName: "Disabled name", status: "disabled" },
                    { id: "act_1", localName: "Active name", status: "active" },
                ],
            }),
            getTemplates: vi.fn().mockResolvedValue({
                ok: true,
                data: [{ id: 7, name: "DE Leads", ageMin: 21 }],
            }),
            getFanPages: vi.fn().mockResolvedValue({
                ok: true,
                data: [{ id: "10", name: "Deutschland Page", geo: "DE", creativeName: "1" }],
            }),
            getCampaignPagePosts: vi.fn().mockResolvedValue({
                ok: true,
                data: [{ id: "10_20", message: "Post" }],
            }),
            getAdPixels: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            onCampaignCreationProgress: vi.fn(() => () => {}),
            preflightCampaignCreation: vi.fn().mockResolvedValue({
                ok: true,
                data: { postId: "10_20", pageName: "Deutschland Page" },
            }),
            startCampaignCreation: vi.fn().mockResolvedValue({
                ok: true,
                data: {
                    jobId: "campaign-job",
                    task: { waitingReason: null },
                },
            }),
            getPageRebuildRequirements: vi.fn().mockResolvedValue({
                ok: true,
                data: {
                    pageId: "10",
                    pageCreatedAt: null,
                    requiresPageCreatedAt: true,
                },
            }),
            selectPageRebuildFolder: vi.fn().mockResolvedValue({
                ok: true,
                data: "C:/images/page",
            }),
            startPageRebuild: vi.fn().mockResolvedValue({
                ok: true,
                data: { taskId: "task-rebuild" },
            }),
            runCommentingCampaign: vi.fn().mockResolvedValue({
                ok: true,
                data: { task: { id: "comments-task" } },
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
        expect(screen.getByTitle("Копіювати посилання на фанку")).toBeInTheDocument();
        expect(screen.getByTitle("Відкрити фанку у Facebook")).toBeInTheDocument();
        expect(screen.getByTitle("Копіювати посилання на пост")).toBeInTheDocument();
        expect(screen.getByTitle("Відкрити пост у Facebook")).toBeInTheDocument();
    });

    it("запускає ручне коментування рекламної об’яви без реплаїв", async () => {
        const showToast = vi.fn();
        render(
            <PagesTab
                selectedAccount={{ accountKey: "client", status: "active" }}
                pages={[{
                    id: "10",
                    name: "Deutschland Page",
                    geo: "HU",
                    creativeName: "1",
                    isFavorite: true,
                }]}
                adAccounts={[]}
                groups={[{ groupId: "hu-group", groupName: "Comments [HU]" }]}
                selectedPageId="10"
                setSelectedPageId={vi.fn()}
                onPagesChange={vi.fn()}
                onRefresh={vi.fn()}
                settings={settings}
                onError={vi.fn()}
                showToast={showToast}
            />
        );

        await waitFor(() => expect(window.adsBot.getCountries)
            .toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole("button", {
            name: "Закоментити рекламну об’яву",
        }));
        expect(screen.getByText(
            "Реплаї будуть опубліковані як окремі звичайні коментарі."
        )).toBeInTheDocument();
        const commentGeo = document.querySelector(
            ".comment-creative-fields-row .geo-select-list"
        );
        expect(commentGeo).toBeInTheDocument();
        fireEvent.click(within(commentGeo).getByRole("button", { name: "GEO" }));
        fireEvent.change(screen.getByPlaceholderText("Дволітерний код країни…"), {
            target: { value: "hu" },
        });
        const geoOptions = within(document.querySelector(
            ".comment-creative-fields-row .select-options"
        )).getAllByRole("button");
        expect(geoOptions).toHaveLength(1);
        expect(geoOptions[0]).toHaveTextContent("HU");
        fireEvent.click(geoOptions[0]);
        fireEvent.change(screen.getByLabelText("Посилання на рекламну об’яву"), {
            target: { value: "https://www.facebook.com/ads/example" },
        });
        const submit = screen.getByRole("button", { name: "У чергу" });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        await waitFor(() => expect(window.adsBot.runCommentingCampaign)
            .toHaveBeenCalledWith({
                accountKey: "client",
                browserMode: "visible",
                commentTarget: "ad",
                commentWorkerConcurrency: 5,
                commentWorkerProxyIds: { 1: "proxy-1" },
                creativeName: "1",
                disableImages: false,
                geo: "HU",
                groupIds: ["hu-group"],
                postUrl: "https://www.facebook.com/ads/example",
                siteUrl: "",
            }));
        expect(showToast).toHaveBeenCalledWith(
            "Коментування поставлено в чергу",
            "success"
        );
    });

    it("окремо оновлює список і вибрану фанку, не ховаючи старі пости", async () => {
        const onRefresh = vi.fn().mockResolvedValue([]);
        const onPagesChange = vi.fn();
        let finishRefresh;
        window.adsBot.refreshSelectedFanPage = vi.fn(() => new Promise((resolve) => {
            finishRefresh = resolve;
        }));
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
                onPagesChange={onPagesChange}
                onRefresh={onRefresh}
                settings={settings}
                onError={vi.fn()}
                showToast={vi.fn()}
            />
        );

        expect(await screen.findByText("Post")).toBeInTheDocument();
        await waitFor(() => expect(window.adsBot.getPagePostsSignature)
            .toHaveBeenCalledWith("client", "10"));

        fireEvent.click(screen.getByTitle("Оновити список фанок"));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
        expect(window.adsBot.refreshSelectedFanPage).not.toHaveBeenCalled();

        const selectedRefresh = screen.getByTitle(
            "Оновити вибрану фанку і пости"
        );
        fireEvent.click(selectedRefresh);
        expect(screen.getByText("Post")).toBeInTheDocument();
        expect(selectedRefresh.querySelector("svg")).toHaveClass("spin");

        finishRefresh({
            ok: true,
            data: {
                page: { id: "10", name: "Updated Page" },
                posts: [{
                    id: "10_20",
                    message: "Updated post",
                    createdTime: "2026-08-21T10:00:00.000Z",
                    thumbnailUrl: `adsbot-cache://image/${"b".repeat(64)}.jpg`,
                }],
                postCount: 1,
            },
        });
        expect(await screen.findByText("Updated post")).toBeInTheDocument();
        expect(screen.getByAltText("Прев’ю поста")).toHaveAttribute(
            "src",
            `adsbot-cache://image/${"a".repeat(64)}.jpg`
        );
        expect(onPagesChange).toHaveBeenCalled();
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
        expect(options[0]).toHaveTextContent("Active name");
        expect(options[0]).toHaveTextContent("ID act_1");
        expect(options[1]).toHaveTextContent("act_2");
        expect(screen.getByPlaceholderText("Пошук за ID або назвою…")).toBeInTheDocument();
        expect(screen.queryByText("Disabled name")).not.toBeInTheDocument();
    });

    it("відкриває нове автозаповнене вікно кампанії для вибраного поста", async () => {
        const showToast = vi.fn();
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
                showToast={showToast}
            />
        );

        fireEvent.click(await screen.findByRole("button", { name: "Кампанія" }));
        const accountSelect = screen.getByRole("button", { name: "Рекламний акаунт" });
        await waitFor(() => expect(accountSelect).not.toBeDisabled());
        fireEvent.click(accountSelect);
        fireEvent.click(await screen.findByText("act_1"));
        fireEvent.click(screen.getByRole("button", { name: "Продовжити" }));

        expect(await screen.findByRole("heading", {
            name: "DE | Creo_1 | 21+",
        })).toBeInTheDocument();
        expect(screen.getByText("Джерело реклами")).toBeInTheDocument();
        expect(screen.getAllByText("10_20").length).toBeGreaterThan(0);
        expect(screen.getByText("act_1")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Поставити в чергу" }));

        await waitFor(() => expect(window.adsBot.startCampaignCreation).toHaveBeenCalled());
        expect(window.adsBot.startCampaignCreation.mock.calls[0][0]).toMatchObject({
            accountKey: "client",
            adAccountId: "act_1",
            templateId: 7,
            campaignName: "DE | Creo_1 | 21+",
            pageId: "10",
            postId: "10_20",
            pixelId: "30",
            utm: "utm_source=adsbot",
        });
        expect(showToast).toHaveBeenCalledWith("Кампанію поставлено в чергу", "success");
    });

    it("підтверджує небезпечне пересетаплення та передає вибрану папку", async () => {
        const setSelectedPageId = vi.fn();
        const showToast = vi.fn();
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
                setSelectedPageId={setSelectedPageId}
                onPagesChange={vi.fn()}
                onRefresh={vi.fn()}
                settings={settings}
                onError={vi.fn()}
                showToast={showToast}
            />
        );

        fireEvent.click(screen.getByTitle("Пересетапити фанпейдж"));
        expect(setSelectedPageId).not.toHaveBeenCalled();
        expect(await screen.findByRole("heading", {
            name: "Пересетапити Deutschland Page",
        })).toBeInTheDocument();
        expect(screen.getByText(/видаляться к хрінам/)).toBeInTheDocument();
        expect(screen.getByText("1.*")).toBeInTheDocument();
        expect(screen.getByText("2.*")).toBeInTheDocument();

        const submit = screen.getByRole("button", { name: "Пересетапити фанку" });
        expect(submit).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Вибрати папку" }));
        expect(await screen.findByDisplayValue("C:/images/page")).toBeInTheDocument();
        fireEvent.change(await screen.findByLabelText("Дата створення фанпейджа"), {
            target: { value: "2024-01-01" },
        });
        fireEvent.click(screen.getByLabelText(
            "Я розумію, що всі старі пости й фото буде видалено"
        ));
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        await waitFor(() => expect(window.adsBot.startPageRebuild)
            .toHaveBeenCalledWith({
                accountKey: "client",
                pageId: "10",
                imagesDirectory: "C:/images/page",
                pageCreatedAt: "2024-01-01",
            }));
        expect(showToast).toHaveBeenCalledWith(
            "Пересетаплення фанпейджа поставлено в чергу",
            "success"
        );
    });
});


describe("Пошук GEO", () => {
    afterEach(() => cleanup());

    it("фільтрує лише за дволітерним кодом країни", () => {
        render(
            <GeoSelect
                countries={[
                    { code: "ES", name: "Spain" },
                    { code: "EE", name: "Estonia" },
                    { code: "DE", name: "Germany" },
                ]}
                value=""
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "GEO" }));
        fireEvent.change(screen.getByPlaceholderText("Дволітерний код країни…"), {
            target: { value: "es" },
        });
        const options = within(document.querySelector(".geo-select .select-options"))
            .getAllByRole("button");
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent("ES");
        expect(options[0]).not.toHaveTextContent("Estonia");
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
