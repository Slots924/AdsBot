import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PagesTab from "../tabs/PagesTab.jsx";

const pages = [
    { id: "10", name: "Перша фанка", geo: "DE", language: "de", creativeName: "138" },
    { id: "11", name: "Друга фанка", geo: "DE", language: "de", creativeName: "4" },
];
const props = {
    selectedAccount: { accountKey: "client" }, pages, adAccounts: [], groups: [],
    selectedPageId: "", setSelectedPageId: vi.fn(), onPagesChange: vi.fn(),
    onRefresh: vi.fn(), onError: vi.fn(), showToast: vi.fn(),
    settings: { defaultPixelId: "30", defaultUtm: "utm_source=test", createCampaignsPaused: true },
};
beforeEach(() => {
    vi.clearAllMocks();
    window.adsBot = {
        getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        getPagePostsWithLinks: vi.fn(async (account, pageId) => ({ ok: true, data: [
            { id: `${pageId}_20`, message: `Пост ${pageId} https://example.test` },
            ...(pageId === "10" ? [{ id: "10_21", message: "Інший пост https://example.test" }] : []),
        ] })),
        getAdAccounts: vi.fn().mockResolvedValue({ ok: true, data: [{ id: "act_1", status: "active", currency: "USD", timezoneName: "Europe/Kyiv" }] }),
        getTemplates: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 1, name: "DE Leads", countryCodes: ["DE"], shareAdSetBudget: true }] }),
        getKeitaroCampaignSettings: vi.fn().mockResolvedValue({ ok: true, data: { pixels: [] } }),
        onCampaignCreationProgress: vi.fn(() => () => {}),
        preflightCampaignCreation: vi.fn().mockResolvedValue({ ok: true, data: { postId: "10_20" } }),
        startCampaignCreation: vi.fn().mockResolvedValue({ ok: true, data: { jobId: "batch", task: {} } }),
    };
});
afterEach(cleanup);

it("оновлює всі вибрані фанки під час вибору РК та запускає вибрані креативи з CBO", async () => {
    render(<PagesTab {...props} />);
    expect(screen.getByRole("button", { name: "Запустити креативи" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Вибрати фанпейджу Перша фанка"));
    fireEvent.click(screen.getByLabelText("Вибрати фанпейджу Друга фанка"));
    expect(props.setSelectedPageId).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Запустити креативи/ }));
    expect(screen.getByText("Оберіть рекламний акаунт")).toBeInTheDocument();
    expect(window.adsBot.getPagePostsWithLinks).toHaveBeenCalledWith("client", "10", true);
    expect(window.adsBot.getPagePostsWithLinks).toHaveBeenCalledWith("client", "11", true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Рекламний акаунт" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Рекламний акаунт" }));
    fireEvent.click(await screen.findByRole("button", { name: /act_1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Продовжити" }));
    const list = await screen.findByLabelText("Креативи для запуску");
    await waitFor(() => expect(within(list).getAllByRole("button", { pressed: true })).toHaveLength(3));
    expect(screen.getByLabelText("Бюджет кампанії / день, USD")).toBeDisabled();
    fireEvent.click(within(list).getAllByRole("button")[1]);
    expect(within(list).getAllByRole("button", { pressed: true })).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Бюджет на кампанію · CBO"));
    expect(screen.getByLabelText("Бюджет / ad set, USD")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Бюджет кампанії / день, USD"), { target: { value: "45" } });
    fireEvent.focus(screen.getByRole("combobox", { name: "Шаблон" }));
    fireEvent.click(await screen.findByRole("button", { name: "DE Leads" }));
    expect(screen.getByRole("heading", { level: 2, name: /DE \| CBO/ })).toHaveTextContent("DE | CBO | 2 креативів");
    fireEvent.click(screen.getByRole("button", { name: "Поставити в чергу" }));
    await waitFor(() => expect(window.adsBot.startCampaignCreation).toHaveBeenCalledWith(expect.objectContaining({
        budgetMode: "campaign", campaignBudget: 45, adSetCount: 5,
        posts: [{ pageId: "10", postId: "10_20" }, { pageId: "11", postId: "11_20" }],
        pixelId: "30", templateId: 1, createPaused: true,
    })));
});

it("скидає галочки після виходу зі вкладки", async () => {
    const first = render(<PagesTab {...props} />);
    fireEvent.click(screen.getByLabelText("Вибрати фанпейджу Перша фанка"));
    expect(screen.getByLabelText("Вибрати фанпейджу Перша фанка")).toBeChecked();
    first.unmount();
    render(<PagesTab {...props} />);
    expect(screen.getByLabelText("Вибрати фанпейджу Перша фанка")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Запустити креативи" })).toBeDisabled();
});

it("показує помилку окремої фанки та блокує неповний запуск", async () => {
    window.adsBot.getPagePostsWithLinks.mockImplementation(async (account, pageId) => {
        if (pageId === "11") throw new Error("Немає доступу");
        return { ok: true, data: [{ id: "10_20", message: "https://example.test" }] };
    });
    render(<PagesTab {...props} />);
    fireEvent.click(screen.getByLabelText("Вибрати фанпейджу Перша фанка"));
    fireEvent.click(screen.getByLabelText("Вибрати фанпейджу Друга фанка"));
    fireEvent.click(screen.getByRole("button", { name: /Запустити креативи/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Рекламний акаунт" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Рекламний акаунт" }));
    fireEvent.click(await screen.findByRole("button", { name: /act_1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Продовжити" }));
    expect(await screen.findByText(/Друга фанка: Немає доступу/)).toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox", { name: "Шаблон" }));
    fireEvent.click(await screen.findByRole("button", { name: "DE Leads" }));
    expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeDisabled();
    window.adsBot.getPagePostsWithLinks.mockResolvedValue({ ok: true, data: [{ id: "11_20", message: "https://example.test" }] });
    fireEvent.click(screen.getByRole("button", { name: "Оновити" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Поставити в чергу" })).toBeEnabled());
    expect(screen.queryByText("Оберіть рекламний акаунт")).not.toBeInTheDocument();
});
