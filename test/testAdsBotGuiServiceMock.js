import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdsPowerGroupService
    from "../services/adspower/AdsPowerGroupService.js";
import AdsBotGuiService
    from "../services/gui/AdsBotGuiService.js";
import { prepareCommentsForCampaign }
    from "../services/creatives/prepareCreativeForCampaign.js";


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-gui-service-")
);
const groupsFile = path.join(temporaryDirectory, "groups.json");

try {
    await writeFile(groupsFile, JSON.stringify({
        generated_at: "test",
        source: "profile-api-v2",
        groups: [{ group_id: "old", group_name: "[US] Old" }],
    }));

    let profilesCalls = 0;
    const adsPower = {
        async getProfiles() {
            profilesCalls += 1;
            return [
                { group_id: "2", group_name: "[HU] Hungary" },
                { group_id: "1", group_name: "[CZ] Czechia" },
                { group_id: "2", group_name: "Duplicate" },
            ];
        },
    };
    const groupService = new AdsPowerGroupService({
        adsPower,
        groupsFile,
    });

    assert.deepEqual(
        await groupService.getGroups(),
        [{ groupId: "old", groupName: "[US] Old" }]
    );
    assert.deepEqual(await groupService.refreshGroups(), [
        { groupId: "1", groupName: "[CZ] Czechia" },
        { groupId: "2", groupName: "[HU] Hungary" },
    ]);
    assert.equal(profilesCalls, 1);
    const savedGroups = JSON.parse(await readFile(groupsFile, "utf8"));
    assert.equal(savedGroups.source, "profile-api-v2");
    assert.equal(savedGroups.groups.length, 2);

    const creative = {
        creative: "Post <LINK>",
        comments: [
            { id: "1", text: "Comment <LINK>" },
            { id: "2", text: "No marker" },
        ],
    };
    assert.deepEqual(
        prepareCommentsForCampaign({ creative, siteUrl: "" })
            .map((comment) => comment.text),
        ["Comment ", "No marker"]
    );
    assert.equal(creative.comments[0].text, "Comment <LINK>");
    assert.deepEqual(
        prepareCommentsForCampaign({
            creative: { comments: [{ id: "1", text: "Plain" }] },
        })[0].text,
        "Plain"
    );

    const facebookBackend = {
        async getAccounts() {
            return [{
                accountKey: "active",
                facebookUserId: "1",
                name: "Active",
                status: "active",
                error: null,
            }];
        },
        async getFanPages(accountKey) {
            assert.equal(accountKey, "active");
            return [{ id: "page", name: "Page" }];
        },
        async getAdAccounts(accountKey) {
            assert.equal(accountKey, "active");
            return [{
                id: "act_1",
                accountId: "1",
                name: "Ads",
                accountStatus: 2,
                disableReason: 3,
            }];
        },
        async getAdCampaigns(accountKey, adAccountId, datePreset) {
            assert.equal(accountKey, "active");
            assert.equal(adAccountId, "act_1");
            assert.equal(datePreset, "today");
            return {
                campaigns: [{
                    id: "campaign-1",
                    name: "Campaign",
                    status: "ACTIVE",
                    effectiveStatus: "ACTIVE",
                }],
                insights: [{
                    campaignId: "campaign-1",
                    spend: "20",
                    actions: [{ action_type: "lead", value: "4" }],
                }],
            };
        },
        async getPagePosts(accountKey, options) {
            assert.equal(accountKey, "active");
            return [{ id: `${options.pageId}_post` }];
        },
        async prepareCreative() {
            return { creative: "Prepared", comments: [] };
        },
        async publishPost(options) {
            assert.equal(options.message, "Prepared");
            return {
                postId: "page_post",
                permalinkUrl: "https://www.facebook.com/post",
                verified: true,
            };
        },
    };
    const logs = [];
    let finishScenario;
    const scenarioPromise = new Promise((resolve) => {
        finishScenario = resolve;
    });
    const scenarioOptions = [];
    const guiService = new AdsBotGuiService({
        facebookBackend,
        facebookBackendFactory: async () => facebookBackend,
        adsPower,
        adsPowerGroupService: groupService,
        creativeManager: {
            async getCreative() {
                return creative;
            },
        },
        runCommentingScenarioFn: async (options) => {
            scenarioOptions.push(options);
            return scenarioPromise;
        },
        logger: {
            info: (message) => logs.push(message),
            warn: (message) => logs.push(message),
            error: (message) => logs.push(message),
        },
    });

    await guiService.getAccounts();
    assert.deepEqual(await guiService.getFanPages("active"), [
        { id: "page", name: "Page" },
    ]);
    assert(logs.includes("Знайдено доступних фанпейджів: 1"));
    const adAccounts = await guiService.getAdAccounts("active");
    assert.equal(adAccounts[0].status, "disabled");
    assert.equal(adAccounts[0].disableReason.label, "Ризик або проблема з оплатою");
    assert(!("accessToken" in adAccounts[0]));
    const campaigns = await guiService.getAdCampaigns(
        "active",
        "act_1",
        "today"
    );
    assert.equal(campaigns.campaigns[0].costPerLead, 5);
    assert.deepEqual(await guiService.getPagePosts({
        accountKey: "active",
        pageId: "page",
    }), [{ id: "page_post" }]);

    const post = await guiService.publishCreativePost({
        accountKey: "active",
        pageId: "page",
        geo: "HU",
        creativeName: "138",
        siteUrl: "https://example.com",
    });
    assert.equal(post.postId, "page_post");

    const commenting = guiService.runCommentingCampaign({
        groupIds: ["2"],
        geo: "HU",
        creativeName: "138",
        postUrl: "https://www.facebook.com/post",
        browserMode: "headless",
        disableImages: true,
    });
    const secondCommenting = guiService.runCommentingCampaign({
        groupIds: ["3"],
        geo: "CZ",
        creativeName: "139",
        postUrl: "https://www.facebook.com/other-post",
    });
    finishScenario({
        report: {
            published: [{}],
            skipped: [],
            failedComments: [],
            failedProfiles: [],
            fatalError: null,
            browserMode: "headless",
            disableImages: true,
        },
        reportPath: "report.md",
    });
    assert.equal((await commenting).published, 1);
    assert.equal((await secondCommenting).published, 1);
    assert.equal(scenarioOptions[0].browserMode, "headless");
    assert.equal(scenarioOptions[0].disableImages, true);
    assert.equal(scenarioOptions[1].browserMode, "visible");
    assert.equal(scenarioOptions[1].disableImages, false);
    assert(logs.length > 0);

    console.log("Mock-перевірка AdsBotGuiService пройшла успішно");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
