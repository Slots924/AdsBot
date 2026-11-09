import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreativeTestModal from "../components/CreativeTestModal.jsx";
import CampaignCreationWizard from "../components/CampaignCreationWizard.jsx";
import PagesTab from "../tabs/PagesTab.jsx";
import { buildCreativeTest, prepareCreativeTest } from "../../../services/creatives/creativeTest.js";

const url = "https://example.test/offer";
const page = { id: "10", name: "Тестова фанка", geo: "US", creativeName: "202" };
const account = { id: "act_1", status: "active", localName: "РК тест", currency: "USD", timezoneName: "UTC" };
const settings = { createCampaignsPaused: true, createAdSetsPaused: false, createAdsPaused: true };
const props = { accountKey: "client", page, countries: [], adAccounts: [account], settings, onClose: vi.fn(), onQueued: vi.fn() };
const testData = buildCreativeTest({ sourceText: `Перший\n\nДругий ${url}`, siteUrl: url, creativeName: "202" });
let listener;

beforeEach(() => {
    vi.clearAllMocks();
    window.adsBot = {
        getAdAccounts: vi.fn().mockResolvedValue({ ok: true, data: [account] }),
        getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        selectImage: vi.fn().mockResolvedValue({ ok: true, data: "image.jpg" }),
        prepareCreativeTest: vi.fn(async input => ({ ok: true, data: input.manualCreativeText ? await prepareCreativeTest(input) : { creativeTest: testData } })),
        getTemplates: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 1, name: "US Leads" }] }),
        getLanguages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        getAdPixels: vi.fn().mockResolvedValue({ ok: true, data: [{ id: "30", name: "Pixel" }] }),
        getKeitaroCampaignSettings: vi.fn().mockResolvedValue({ ok: true, data: { pixels: [] } }),
        onCampaignCreationProgress: vi.fn(callback => { listener = callback; return () => {}; }),
        preflightCampaignCreation: vi.fn().mockResolvedValue({ ok: true, data: { pageId: "10", postId: null } }),
        startCampaignCreation: vi.fn().mockResolvedValue({ ok: true, data: { jobId: "test-job", task: {} } }),
        getPagePostsWithLinks: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        openExternal: vi.fn(),
    };
});
afterEach(cleanup);

it("відкриває тест з вкладки фанпейджів без налаштувань коментування", async () => {
    render(<PagesTab selectedAccount={{ accountKey: "client", status: "active" }} pages={[page]} adAccounts={[account]} groups={[]} selectedPageId="10" setSelectedPageId={vi.fn()} onPagesChange={vi.fn()} onRefresh={vi.fn()} settings={settings} onError={vi.fn()} showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Затестити креатив" }));
    expect(screen.getByRole("heading", { name: "Затестити креатив" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Вимкнути коментування")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Акаунти для коментарів" })).not.toBeInTheDocument();
    await waitFor(() => expect(window.adsBot.getAdAccounts).toHaveBeenCalled());
});

it("показує варіанти, переходить до майстра та зберігає текст після повернення", async () => {
    render(<CreativeTestModal {...props} />);
    fireEvent.click(screen.getByLabelText("Власний текст креативу"));
    fireEvent.change(screen.getByLabelText("Текст креативу"), { target: { value: `Перший\n\nДругий ${url}` } });
    fireEvent.change(screen.getByLabelText("Режим тестування"), { target: { value: "individual" } });
    fireEvent.click(screen.getByRole("button", { name: "Вибрати файл" }));
    await screen.findAllByText("image.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Підготувати варіанти" }));
    expect(await screen.findByText("Оголошень: 2")).toBeInTheDocument();
    expect(screen.getByText("Абзац 2")).toBeInTheDocument();
    expect(screen.getByText(`Перший ${url}`, { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Рекламний акаунт" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Рекламний акаунт" }));
    fireEvent.click(screen.getByRole("button", { name: /РК тест.*ID act_1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Далі: створення кампанії" }));
    expect(screen.getByLabelText("Ad sets")).toBeDisabled();
    expect(screen.getByLabelText("Ad sets")).toHaveValue(1);
    expect(screen.queryByLabelText("Пошук поста")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "До редагування" }));
    expect(screen.getByLabelText("Текст креативу")).toHaveValue(`Перший\n\nДругий ${url}`);
    expect(screen.getByText("Оголошень: 2")).toBeInTheDocument();
});

it("пропонує вибрати основний URL, а зміна тексту скидає перегляд", async () => {
    render(<CreativeTestModal {...props} />);
    fireEvent.click(screen.getByLabelText("Власний текст креативу"));
    fireEvent.change(screen.getByLabelText("Текст креативу"), { target: { value: `${url}\n\nhttps://other.test/` } });
    fireEvent.click(screen.getByRole("button", { name: "Вибрати файл" }));
    await screen.findAllByText("image.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Підготувати варіанти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Виберіть основне посилання");
    fireEvent.change(screen.getByRole("combobox", { name: "Основне посилання" }), { target: { value: "https://other.test/" } });
    fireEvent.click(screen.getByRole("button", { name: "Підготувати варіанти" }));
    await screen.findByText("Оголошень: 2");
    fireEvent.change(screen.getByLabelText("Текст креативу"), { target: { value: "Без URL" } });
    expect(screen.queryByText("Оголошень: 2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Підготувати варіанти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("не знайдено");
});

it("передає зафіксований тест, початкові статуси та показує результат без обіцянки модерації", async () => {
    render(<CampaignCreationWizard accountKey="client" adAccount={account} sourcePage={page} initialPageId="10" creativeTest={testData} testImagePath="image.jpg" createPaused createAdSetsPaused={false} createAdsPaused onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Шаблон" })).toBeEnabled());
    fireEvent.focus(screen.getByRole("combobox", { name: "Шаблон" }));
    fireEvent.click(screen.getByRole("button", { name: "US Leads" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Поставити в чергу" }));
    await waitFor(() => expect(window.adsBot.startCampaignCreation).toHaveBeenCalled());
    expect(window.adsBot.startCampaignCreation.mock.calls[0][0]).toMatchObject({ adSetCount: 1, creativeMode: "image", creativeTest: testData, imagePath: "image.jpg", createPaused: true, createAdSetsPaused: false, createAdsPaused: true });
    await act(async () => listener({ jobId: "test-job", stage: "complete", completed: 7, total: 7, objects: { campaignId: "100" } }));
    expect(screen.getByText(/Результати модерації перевіряйте/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Відкрити кампанію в Ads Manager" }));
    expect(window.adsBot.openExternal).toHaveBeenCalledWith(expect.stringContaining("selected_campaign_ids=100"));
    expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeDisabled();
});

it("запізніле читання задачі не перезаписує новіший прогрес", async () => {
    let resolveJob;
    window.adsBot.getCampaignCreationJob = vi.fn(() => new Promise(resolve => { resolveJob = resolve; }));
    render(<CampaignCreationWizard accountKey="client" adAccount={account} sourcePage={page} initialPageId="10" creativeTest={testData} testImagePath="image.jpg" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Шаблон" })).toBeEnabled());
    fireEvent.focus(screen.getByRole("combobox", { name: "Шаблон" }));
    fireEvent.click(screen.getByRole("button", { name: "US Leads" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Поставити в чергу" }));
    await waitFor(() => expect(window.adsBot.getCampaignCreationJob).toHaveBeenCalled());
    await act(async () => listener({ jobId: "test-job", stage: "ad", message: "Оголошення 2 створено", completed: 6, total: 7, objects: { campaignId: "100" } }));
    await act(async () => resolveJob({ ok: true, data: { status: "running", stage: "preflight", completed: 0, total: 7, objects: {} } }));
    expect(screen.getByText("Оголошення 2 створено")).toBeInTheDocument();
});
