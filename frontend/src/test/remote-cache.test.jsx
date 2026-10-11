import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdAccountsTab from "../tabs/AdAccountsTab.jsx";
import PagesTab from "../tabs/PagesTab.jsx";

const adAccounts = [{ id: "act_1", name: "Shared account", status: "active", currency: "USD", isFavorite: false }];
const campaignData = (name, revision = 1) => ({
    adAccountId: "act_1", datePreset: "today", revision, cacheHit: true,
    campaigns: [{ id: "c1", name, status: "PAUSED", effectiveStatus: "PAUSED", spend: 42 }],
});
const adsProps = {
    workspaceAccounts: adAccounts, selectedId: "act_1", setSelectedId: vi.fn(),
    onError: vi.fn(), showToast: vi.fn(), addLog: vi.fn(),
};

describe("Спільний дисковий кеш у GUI", () => {
    let cacheListener;
    let refreshedListener;
    beforeEach(() => {
        window.adsBot = {
            getAdCampaigns: vi.fn().mockResolvedValue({ ok: true, data: campaignData("Saved campaign") }),
            onRemoteCacheUpdated: vi.fn((callback) => { cacheListener = callback; return () => {}; }),
            onCampaignsRefreshed: vi.fn((callback) => { refreshedListener = callback; return () => {}; }),
            getCountries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        };
    });
    afterEach(cleanup);

    it("відкриває збережені кампанії з неактивним токеном", async () => {
        render(<AdAccountsTab {...adsProps} selectedAccount={{ accountKey: "broken", status: "invalid" }} />);
        expect(await screen.findByText("Saved campaign")).toBeInTheDocument();
        expect(window.adsBot.getAdCampaigns).toHaveBeenCalledWith("broken", "act_1", "today", false, false);
        expect(screen.getByText(/Доступні останні збережені дані/)).toBeInTheDocument();
    });

    it("оновлює спільну кампанію після зміни через інший клієнт і залишає дані при помилці читання", async () => {
        render(<AdAccountsTab {...adsProps} selectedAccount={{ accountKey: "a", status: "active" }} />);
        await screen.findByText("Saved campaign");
        window.adsBot.getAdCampaigns.mockResolvedValueOnce({ ok: true, data: campaignData("Changed through B", 2) });
        await act(async () => cacheListener({ kind: "campaigns", adAccountId: "act_1", accountKey: "b" }));
        expect(await screen.findByText("Changed through B")).toBeInTheDocument();
        window.adsBot.getAdCampaigns.mockResolvedValueOnce({ ok: false, error: { message: "Read failed" } });
        await act(async () => cacheListener({ kind: "campaigns", adAccountId: "act_1", accountKey: "b" }));
        expect(await screen.findByText(/Не вдалося оновити: Read failed/)).toBeInTheDocument();
        expect(screen.getByText("Changed through B")).toBeInTheDocument();
    });

    it.each(["resolve", "reject"])("запізніле читання (%s) не затирає новіший snapshot іншого клієнта", async (outcome) => {
        let resolveOld;
        let rejectOld;
        window.adsBot.getAdCampaigns.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
        render(<AdAccountsTab {...adsProps} selectedAccount={{ accountKey: "a", status: "active" }} />);
        await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
        await act(async () => refreshedListener({ accountKey: "b", adAccountId: "act_1", datePreset: "today", data: campaignData("New snapshot", 3) }));
        expect(await screen.findByText("New snapshot")).toBeInTheDocument();
        await act(async () => outcome === "resolve"
            ? resolveOld({ ok: true, data: campaignData("Old snapshot", 1) })
            : rejectOld(new Error("Old request failed")));
        expect(screen.queryByText("Old snapshot")).not.toBeInTheDocument();
        expect(screen.getByText("New snapshot")).toBeInTheDocument();
    });

    it("оновлює пости тієї самої фанки з іншого клієнта разом із локальним прев'ю", async () => {
        window.adsBot.getPagePostsWithLinks = vi.fn().mockResolvedValue({ ok: true, data: [{
            id: "10_old", message: "Old https://example.test", createdTime: "2026-10-11T12:00:00Z",
        }] });
        window.adsBot.getPagePostsSignature = vi.fn().mockResolvedValue({ ok: true, data: { count: 1, postIds: ["10_old"] } });
        render(<PagesTab selectedAccount={{ accountKey: "a", status: "active" }}
            pages={[{ id: "10", name: "Shared page" }]} adAccounts={[]} groups={[]} settings={{}}
            selectedPageId="10" setSelectedPageId={vi.fn()} onPagesChange={vi.fn()} onError={vi.fn()} showToast={vi.fn()} />);
        await screen.findByText("Old https://example.test");
        window.adsBot.getPagePostsWithLinks.mockResolvedValueOnce({ ok: true, data: [{
            id: "10_new", message: "New https://example.test", createdTime: "2026-10-11T13:00:00Z",
            thumbnailUrl: "adsbot-cache://image/test.png",
        }] });
        await act(async () => cacheListener({ kind: "posts", pageId: "10", accountKey: "b" }));
        expect(await screen.findByText("New https://example.test")).toBeInTheDocument();
        expect(screen.getByAltText("Прев’ю поста")).toHaveAttribute("src", "adsbot-cache://image/test.png");
        expect(window.adsBot.getPagePostsWithLinks).toHaveBeenLastCalledWith("a", "10", false);
    });
});
