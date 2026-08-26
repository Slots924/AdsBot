import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "../components/Sidebar.jsx";
import ProxyStrip from "../components/ProxyStrip.jsx";
import AccountsTab from "../tabs/AccountsTab.jsx";
import SettingsModal from "../components/SettingsModal.jsx";
import BackgroundTaskPanel from "../components/BackgroundTaskPanel.jsx";
import AdAccountsTab from "../tabs/AdAccountsTab.jsx";
import PublishTab from "../tabs/PublishTab.jsx";
import TemplatesTab from "../tabs/TemplatesTab.jsx";
import JournalTab from "../tabs/JournalTab.jsx";
import { findGroupForGeo } from "../lib/groups.js";
import { sortGroups, sortProfiles } from "../lib/commentAccountGroups.js";
import CommentAccountsTab from "../tabs/CommentAccountsTab.jsx";


describe("GUI helpers", () => {
    beforeEach(() => {
        window.adsBot = {
            getFanPages: vi.fn(),
            getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            getLogs: vi.fn().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } }),
            getLogScopes: vi.fn().mockResolvedValue({ ok: true, data: [] }),
            getReports: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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

    it("ставить обрані групи AdsPower зверху і сортує решту за абеткою", () => {
        const groups = [
            { groupId: "3", groupName: "Zeta" },
            { groupId: "1", groupName: "Alpha" },
            { groupId: "2", groupName: "Beta" },
        ];
        expect(sortGroups(groups, ["3"]).map((item) => item.groupId)).toEqual([
            "3",
            "1",
            "2",
        ]);
        expect(sortProfiles(
            [
                { profileNo: "12", name: "B", tags: [] },
                { profileNo: "2", name: "A", tags: [] },
            ],
            "profileNo",
            "asc"
        ).map((item) => item.profileNo)).toEqual(["2", "12"]);
    });

    it("показує вкладку акаунтів під коментарі з двома панелями груп", async () => {
        window.adsBot.getAdsPowerGroupProfiles = vi.fn().mockResolvedValue({
            ok: true,
            data: [
                {
                    profileId: "p1",
                    profileNo: "10",
                    name: "m_Test",
                    tags: [{ name: "Man" }],
                },
            ],
        });
        render(
            <CommentAccountsTab
                groups={[
                    { groupId: "1", groupName: "Alpha" },
                    { groupId: "2", groupName: "Beta" },
                ]}
                onGroupsChange={vi.fn()}
                favoriteGroupIds={[]}
                onFavoriteGroupIdsChange={vi.fn()}
                onError={vi.fn()}
                showToast={vi.fn()}
            />
        );
        expect(screen.getByText("Акаунти під коментарі")).toBeInTheDocument();
        expect(screen.getAllByLabelText(/Група /).length).toBe(2);
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

    it("створює та архівує Facebook API-клієнт через sidebar", async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        const onSetArchived = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(window, "confirm").mockReturnValue(true);
        render(
            <Sidebar
                accounts={[{
                    accountKey: "fp_hub",
                    name: "Hub",
                    facebookUserId: "615",
                    status: "active",
                    archived: false,
                }]}
                selectedAccountKey=""
                loading={false}
                onSelect={vi.fn()}
                onRefresh={vi.fn()}
                onCreate={onCreate}
                onUpdate={vi.fn()}
                onSetArchived={onSetArchived}
                onError={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle("Додати акаунт"));
        fireEvent.change(screen.getByLabelText("accountKey"), {
            target: { value: "client_2" },
        });
        fireEvent.change(screen.getByLabelText("userAgent"), {
            target: { value: "Mozilla/5.0 Test" },
        });
        fireEvent.change(screen.getByLabelText("accessToken"), {
            target: { value: "token" },
        });
        fireEvent.change(screen.getByLabelText(/Cookie або AdsPower JSON/), {
            target: { value: "c_user=1; xs=2" },
        });
        fireEvent.click(screen.getByText("Створити"));
        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            accountKey: "client_2",
            userAgent: "Mozilla/5.0 Test",
            accessToken: "token",
            cookie: "c_user=1; xs=2",
        }));

        fireEvent.click(screen.getByTitle("В архів"));
        await waitFor(() => expect(onSetArchived)
            .toHaveBeenCalledWith("fp_hub", true));
    });

    it("у standalone показує нижню кнопку додавання API-клієнта", () => {
        render(
            <Sidebar
                standalone
                accounts={[]}
                selectedAccountKey=""
                loading={false}
                onSelect={vi.fn()}
                onRefresh={vi.fn()}
                onCreate={vi.fn()}
                onUpdate={vi.fn()}
                onSetArchived={vi.fn()}
                onError={vi.fn()}
            />
        );

        expect(screen.getByTitle("Додати акаунт")).toBeInTheDocument();
        expect(screen.getByText("Додати API-клієнта")).toBeInTheDocument();
        expect(screen.queryByText("AdsBot")).not.toBeInTheDocument();
    });

    it("показує проксі й перевіряє статус", async () => {
        const onCheck = vi.fn().mockResolvedValue({
            working: true,
            ip: "203.0.113.10",
        });
        render(
            <ProxyStrip
                proxies={[{
                    id: "proxy-001",
                    adsPowerId: 14,
                    name: "Київ",
                    type: "socks5",
                    host: "proxy.example.com",
                    port: "10000",
                    hasRefreshUrl: true,
                }]}
                loading={false}
                onCreate={vi.fn()}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onCheck={onCheck}
                onRefreshIp={vi.fn()}
                onError={vi.fn()}
            />
        );

        expect(screen.getByText("14")).toBeInTheDocument();
        expect(screen.getByText("Київ")).toBeInTheDocument();
        expect(screen.getByText("API")).toBeInTheDocument();
        fireEvent.click(screen.getByTitle("Перевірити статус"));
        await waitFor(() => expect(onCheck).toHaveBeenCalledWith("proxy-001"));
        expect(await screen.findByText("IP 203.0.113.10")).toBeInTheDocument();
        expect(document.querySelector(".proxy-flashlight.on")).toBeInTheDocument();
    });

    it("крутить кнопку зміни IP і фарбує її після відповіді", async () => {
        const onRefreshIp = vi.fn().mockResolvedValue({
            working: false,
            timedOut: true,
        });
        render(
            <ProxyStrip
                proxies={[{
                    id: "proxy-001",
                    adsPowerId: 9,
                    name: "Одеса",
                    type: "http",
                    host: "proxy.example.com",
                    port: "10000",
                    hasRefreshUrl: true,
                }]}
                loading={false}
                onCreate={vi.fn()}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onCheck={vi.fn()}
                onRefreshIp={onRefreshIp}
                onError={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle("Оновити IP"));
        await waitFor(() => expect(onRefreshIp).toHaveBeenCalledWith("proxy-001"));
        expect(screen.getByTitle("Оновити IP").className).toContain("fail");
    });

    it("створює проксі через форму", async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(
            <ProxyStrip
                proxies={[]}
                loading={false}
                onCreate={onCreate}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onCheck={vi.fn()}
                onRefreshIp={vi.fn()}
                onError={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle("Додати проксі"));
        fireEvent.change(screen.getByLabelText("AdsPower ID"), {
            target: { value: "14" },
        });
        fireEvent.change(screen.getByLabelText("Ім’я"), {
            target: { value: "Київ" },
        });
        fireEvent.change(screen.getByLabelText("Хост"), {
            target: { value: "proxy.example.com" },
        });
        fireEvent.change(screen.getByLabelText("Порт"), {
            target: { value: "10000" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Додати" }));
        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            adsPowerId: "14",
            name: "Київ",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            username: "",
            password: "",
            refreshUrl: "",
        }));
    });

    it("заповнює поля проксі з вставленого рядка", async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        const onCheckConfig = vi.fn().mockResolvedValue({
            working: true,
            ip: "203.0.113.10",
        });
        render(
            <ProxyStrip
                proxies={[]}
                loading={false}
                onCreate={onCreate}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onCheck={vi.fn()}
                onCheckConfig={onCheckConfig}
                onRefreshIp={vi.fn()}
                onError={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle("Додати проксі"));
        fireEvent.change(screen.getByLabelText("Вставити проксі"), {
            target: {
                value: "socks5://proxy.example.com:10000:demo-user:demo-pass[https://provider.example/changeip/token]",
            },
        });
        fireEvent.click(screen.getByRole("button", { name: "ОК" }));
        expect(screen.getByLabelText("Хост").value).toBe("proxy.example.com");
        expect(screen.getByLabelText("Порт").value).toBe("10000");
        expect(screen.getByLabelText("Логін проксі").value).toBe("demo-user");
        fireEvent.click(screen.getByRole("button", { name: "Перевірити проксі" }));
        await waitFor(() => expect(onCheckConfig).toHaveBeenCalled());
        expect(await screen.findByText("IP 203.0.113.10")).toBeInTheDocument();
    });

    it("підставляє збережені дані проксі в форму редагування", async () => {
        const onGet = vi.fn().mockResolvedValue({
            id: "proxy-001",
            adsPowerId: 14,
            name: "Київ",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            username: "demo-user",
            password: "demo-pass",
            refreshUrl: "https://provider.example/changeip/token",
        });
        render(
            <ProxyStrip
                proxies={[{
                    id: "proxy-001",
                    adsPowerId: 14,
                    name: "Київ",
                    type: "socks5",
                    host: "proxy.example.com",
                    port: "10000",
                    hasRefreshUrl: true,
                }]}
                loading={false}
                onCreate={vi.fn()}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onGet={onGet}
                onCheck={vi.fn()}
                onRefreshIp={vi.fn()}
                onError={vi.fn()}
            />
        );

        fireEvent.click(screen.getByTitle("Редагувати"));
        await waitFor(() => expect(onGet).toHaveBeenCalledWith("proxy-001"));
        expect(screen.getByLabelText("Логін проксі").value).toBe("demo-user");
        expect(screen.getByLabelText("Пароль проксі").value).toBe("demo-pass");
        expect(screen.getByLabelText("Посилання для зміни IP").value)
            .toBe("https://provider.example/changeip/token");
        expect(screen.queryByText(/залишаться без змін/)).not.toBeInTheDocument();
    });

    it("ставить дві полоси клієнтів і проксі поруч", () => {
        render(
            <AccountsTab
                accounts={[]}
                selectedAccountKey=""
                accountsLoading={false}
                onSelectAccount={vi.fn()}
                onRefreshAccounts={vi.fn()}
                onCreateAccount={vi.fn()}
                onUpdateAccount={vi.fn()}
                onSetArchived={vi.fn()}
                proxies={[]}
                proxiesLoading={false}
                onCreateProxy={vi.fn()}
                onUpdateProxy={vi.fn()}
                onDeleteProxy={vi.fn()}
                onCheckProxy={vi.fn()}
                onRefreshProxyIp={vi.fn()}
                onError={vi.fn()}
            />
        );

        expect(document.querySelector(".accounts-workspace")).toBeInTheDocument();
        expect(screen.getByText("API-клієнти")).toBeInTheDocument();
        expect(screen.getByText("Проксі")).toBeInTheDocument();
        expect(screen.getByTitle("Додати проксі")).toBeInTheDocument();
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
                lastPublishedPost={{
                    accountKey: "fp_hub",
                    pageId: "page-1",
                    postId: "page-1_post-1",
                }}
            />
        );

        expect(await screen.findByText("1 доступних фанпейджів"))
            .toBeInTheDocument();
        expect(screen.getByDisplayValue("page-1_post-1"))
            .toHaveAttribute("readonly");
    });

    it("одразу додає публікацію в чергу та звільняє форму", async () => {
        window.adsBot.getFanPages.mockResolvedValue({
            ok: true,
            data: [{ id: "page-1", name: "Test Page" }],
        });
        window.adsBot.publishCreativePost = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                taskId: "task-publication",
                task: {
                    id: "task-publication",
                    type: "publication",
                    name: "Публікація · HU · 138",
                    status: "queued",
                },
            },
        });
        render(
            <PublishTab
                selectedAccount={{ accountKey: "fp_hub", status: "active" }}
                onError={vi.fn()}
                addLog={vi.fn()}
                pageId="page-1"
                setPageId={vi.fn()}
                form={{
                    geo: "HU",
                    creativeName: "138",
                    siteUrl: "https://example.com",
                    imagePath: "",
                }}
                setForm={vi.fn()}
            />
        );
        fireEvent.click(await screen.findByRole("button", { name: "Запостити креатив" }));
        await waitFor(() => expect(window.adsBot.publishCreativePost).toHaveBeenCalledWith({
            accountKey: "fp_hub",
            pageId: "page-1",
            geo: "HU",
            creativeName: "138",
            siteUrl: "https://example.com",
            imagePath: "",
        }));
        expect(await screen.findByText(/додано в чергу/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Запостити креатив" })).toBeEnabled();
    });

    it("створює та показує локальний шаблон", async () => {
        window.adsBot.getTemplates = vi.fn().mockResolvedValue({
            ok: true,
            data: [],
        });
        window.adsBot.createTemplate = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                id: 1,
                name: "AT Slot",
                countryCodes: [],
                updatedAt: "2026-08-19T07:00:00.000Z",
            },
        });

        render(
            <TemplatesTab onError={vi.fn()} showToast={vi.fn()} />
        );

        expect(await screen.findByText("Шаблонів ще немає"))
            .toBeInTheDocument();
        fireEvent.click(screen.getByText("Створити шаблон"));
        fireEvent.change(screen.getByPlaceholderText("Наприклад, AT Slot"), {
            target: { value: "AT Slot" },
        });
        expect(screen.getByLabelText("Вік до")).toHaveDisplayValue("65+");
        fireEvent.change(screen.getByLabelText("Пристрої"), {
            target: { value: "mobile" },
        });
        fireEvent.change(screen.getByLabelText("Операційна система"), {
            target: { value: "iOS" },
        });
        fireEvent.change(screen.getByLabelText("Бенефіціар"), {
            target: { value: "Example Beneficiary LLC" },
        });
        fireEvent.click(screen.getByRole("checkbox", {
            name: /Платник збігається з бенефіціаром/,
        }));
        fireEvent.change(screen.getByLabelText("Платник"), {
            target: { value: "Example Payor LLC" },
        });
        fireEvent.submit(screen.getByText("Новий шаблон").closest("form"));

        expect(await screen.findByText("AT Slot")).toBeInTheDocument();
        expect(window.adsBot.createTemplate).toHaveBeenCalledWith({
            name: "AT Slot",
            countryCodes: [],
            gender: "any",
            ageMin: 18,
            ageMax: 65,
            devicePlatforms: ["mobile"],
            operatingSystems: ["iOS"],
            placements: {
                facebook: ["feed"],
                instagram: [],
            },
            shareAdSetBudget: false,
            disableCreativeEnhancements: true,
            dsaBeneficiary: "Example Beneficiary LLC",
            dsaPayorSameAsBeneficiary: false,
            dsaPayor: "Example Payor LLC",
        });
    });

    it("показує обрані та інші РК і завантажує кампанії по кліку", async () => {
        window.adsBot.getAdAccounts = vi.fn().mockResolvedValue({
            ok: true,
            data: [
                {
                    id: "act_1",
                    accountId: "1",
                    name: "Meta Main",
                    localName: "Ім’я 1",
                    status: "active",
                    accountStatus: 1,
                    isFavorite: true,
                    favoritePosition: 0,
                    disableReason: { code: null, label: "Не вказано" },
                    currency: "USD",
                    timezoneName: "Europe/Kyiv",
                    timezoneOffsetHoursUtc: 3,
                    todaySpend: "12.50",
                    dailySpendLimit: "5000",
                },
                {
                    id: "act_2",
                    accountId: "2",
                    name: "Meta Disabled",
                    localName: "Ім’я 2",
                    status: "disabled",
                    accountStatus: 2,
                    isFavorite: false,
                    favoritePosition: null,
                    disableReason: { code: 3, label: "Проблема з оплатою" },
                    currency: "USD",
                },
            ],
        });
        window.adsBot.getAdCampaigns = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                adAccountId: "act_1",
                datePreset: "today",
                campaigns: [{
                    id: "campaign-1",
                    name: "A Campaign",
                    effectiveStatus: "ACTIVE",
                    leads: 2,
                    spend: 10,
                    costPerLead: 5,
                }],
            },
        });
        window.adsBot.setAdAccountFavorite = vi.fn().mockResolvedValue({
            ok: true,
            data: ["act_1", "act_2"],
        });
        window.adsBot.renameAdAccount = vi.fn();
        window.adsBot.reorderFavoriteAdAccounts = vi.fn();

        render(
            <AdAccountsTab
                selectedAccount={{ accountKey: "fp_hub", status: "active" }}
                onError={vi.fn()}
            />
        );

        expect(await screen.findByText("Ім’я 1")).toBeInTheDocument();
        expect(screen.getByText("Інші РК")).toBeInTheDocument();
        expect(screen.getByText("Проблема з оплатою")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Ім’я 1"));

        expect(await screen.findByText("A Campaign")).toBeInTheDocument();
        expect(screen.getAllByText("ID: 1").length).toBeGreaterThan(0);
        expect(screen.getByText("Europe/Kyiv · UTC+3")).toBeInTheDocument();
        expect(screen.getAllByTitle("Копіювати ID рекламного кабінету").length)
            .toBeGreaterThan(0);
        expect(window.adsBot.getAdCampaigns).toHaveBeenCalledWith(
            "fp_hub",
            "act_1",
            "today",
            false
        );

        fireEvent.click(screen.getByText("7 днів"));
        await waitFor(() => expect(window.adsBot.getAdCampaigns)
            .toHaveBeenCalledWith("fp_hub", "act_1", "last_7d", false));

        fireEvent.click(screen.getByTitle("Додати до обраних"));
        expect(window.adsBot.setAdAccountFavorite).toHaveBeenCalledWith(
            "fp_hub",
            "act_2",
            true
        );
    });

    it("змінює масштаб у налаштуваннях", () => {
        const onScaleChange = vi.fn();
        const onCommentBrowserModeChange = vi.fn();
        const onCommentDisableImagesChange = vi.fn();
        const onLogLevelChange = vi.fn();
        render(
            <SettingsModal
                scale={1.3}
                onScaleChange={onScaleChange}
                createCampaignsPaused
                onCreateCampaignsPausedChange={vi.fn()}
                commentWorkerConcurrency={5}
                onCommentWorkerConcurrencyChange={vi.fn()}
                defaultPixelId=""
                onDefaultPixelIdChange={vi.fn()}
                defaultUtm=""
                onDefaultUtmChange={vi.fn()}
                commentBrowserMode="visible"
                onCommentBrowserModeChange={onCommentBrowserModeChange}
                commentDisableImages={false}
                onCommentDisableImagesChange={onCommentDisableImagesChange}
                logLevel="info"
                onLogLevelChange={onLogLevelChange}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByText("130%")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Масштаб інтерфейсу"), {
            target: { value: "140" },
        });
        expect(onScaleChange).toHaveBeenCalledWith(1.4);
        fireEvent.change(screen.getByLabelText("Рівень логування"), {
            target: { value: "debug" },
        });
        expect(onLogLevelChange).toHaveBeenCalledWith("debug");
        fireEvent.click(screen.getByRole("button", { name: /Коментарі/ }));
        fireEvent.change(screen.getByLabelText("Режим браузера для коментарів"), {
            target: { value: "headless" },
        });
        expect(onCommentBrowserModeChange).toHaveBeenCalledWith("headless");
        fireEvent.click(screen.getByRole("checkbox", { name: /Не завантажувати зображення/ }));
        expect(onCommentDisableImagesChange).toHaveBeenCalledWith(true);
        expect(screen.getByLabelText("Воркер 1")).toBeInTheDocument();
        expect(screen.getByLabelText("Призначити проксі воркеру 1")).toBeInTheDocument();
    });

    it("показує збережені події та структуровані звіти", async () => {
        window.adsBot.getLogScopes.mockResolvedValue({ ok: true, data: ["tasks"] });
        window.adsBot.getLogs.mockResolvedValue({
            ok: true,
            data: {
                items: [{
                    id: "log-1",
                    timestamp: "2026-08-20T10:00:00.000Z",
                    level: "error",
                    scope: "tasks",
                    message: "Meta повернула помилку",
                    context: { taskId: "task-1" },
                }],
                nextCursor: null,
            },
        });
        window.adsBot.getReports.mockResolvedValue({
            ok: true,
            data: [{
                id: "report-1",
                taskId: "task-1",
                type: "publication",
                title: "Публікація · HU · 138",
                status: "completed",
                createdAt: "2026-08-20T10:01:00.000Z",
            }],
        });
        window.adsBot.getReport = vi.fn().mockResolvedValue({
            ok: true,
            data: {
                id: "report-1",
                taskId: "task-1",
                type: "publication",
                title: "Публікація · HU · 138",
                status: "completed",
                resultSummary: { postId: "10_20" },
            },
        });
        window.adsBot.exportReportMarkdown = vi.fn().mockResolvedValue({ ok: true, data: true });
        render(<JournalTab onError={vi.fn()} showToast={vi.fn()} />);
        expect(await screen.findByText("Meta повернула помилку")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Звіти/ }));
        expect(await screen.findByText("Публікація · HU · 138")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Публікація · HU · 138"));
        expect(await screen.findByText(/10_20/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Markdown/ }));
        await waitFor(() => expect(window.adsBot.exportReportMarkdown).toHaveBeenCalledWith("report-1"));
    });

    it("показує фонові задачі та дозволяє зупинити активну", async () => {
        window.adsBot.cancelBackgroundTask = vi.fn().mockResolvedValue({
            ok: true,
            data: { id: "task-1", status: "running" },
        });
        render(
            <BackgroundTaskPanel
                tasks={[{
                    id: "task-1",
                    type: "comments",
                    name: "Коментарі · HU · 138",
                    status: "running",
                    createdAt: "2026-08-19T10:00:00.000Z",
                    metadata: { browserMode: "headless", disableImages: true },
                    progress: {
                        stage: "comment",
                        completed: 2,
                        total: 5,
                        published: 2,
                        message: "Коментар 3 · профіль 12",
                    },
                }]}
                collapsed={false}
                onCollapsedChange={vi.fn()}
                onRefresh={vi.fn()}
                onError={vi.fn()}
            />
        );

        expect(screen.getByText("Коментарі · HU · 138")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Коментарі · HU · 138"));
        expect(screen.getByText("Headless")).toBeInTheDocument();
        expect(screen.getByText("Вимкнені")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Зупинити" }));
        await waitFor(() => expect(window.adsBot.cancelBackgroundTask)
            .toHaveBeenCalledWith("task-1"));
    });
});
