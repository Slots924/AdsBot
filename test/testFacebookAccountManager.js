import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import FacebookAccountManager, {
    normalizeFacebookCookie,
} from "../facebook/accounts/FacebookAccountManager.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-accounts-"));

try {
    const accountsFile = path.join(directory, "accounts.json");
    const manager = new FacebookAccountManager({ accountsFile });
    const adsPowerCookies = JSON.stringify([
        { domain: ".facebook.com", name: "c_user", value: "100" },
        { domain: ".facebook.com", name: "xs", value: "session=value" },
        { domain: ".facebook.com", name: "unneeded_cookie", value: "drop" },
        { domain: ".example.com", name: "c_user", value: "drop" },
    ]);

    assert.equal(
        normalizeFacebookCookie(adsPowerCookies),
        "c_user=100; xs=session=value"
    );
    assert.equal(
        normalizeFacebookCookie("c_user=100; xs=session=value; ignored=x"),
        "c_user=100; xs=session=value"
    );

    const created = await manager.create({
        accountKey: "client_1",
        userAgent: "Mozilla/5.0 Test",
        accessToken: "secret-token",
        cookie: adsPowerCookies,
    });
    assert.equal(created.accountKey, "client_1");
    assert.equal(created.archived, false);
    assert.equal(created.hasAccessToken, true);
    assert(!("accessToken" in created));
    assert(!("cookie" in created));

    const adspowerOnly = await manager.create({
        accountKey: "client_2",
        adsPowerProfileNo: "1791",
    });
    assert.equal(adspowerOnly.adsPowerProfileNo, "1791");
    assert.equal(adspowerOnly.hasAccessToken, false);

    const updatedWithoutCredentials = await manager.update("client_2", {
        adsPowerProfileNo: "1792",
    });
    assert.equal(updatedWithoutCredentials.adsPowerProfileNo, "1792");

    const updatedProfileNo = await manager.update("client_2", {
        adsPowerProfileNo: "1758",
    });
    assert.equal(updatedProfileNo.adsPowerProfileNo, "1758");

    await assert.rejects(manager.create({
        accountKey: "CLIENT_1",
        userAgent: "agent",
        accessToken: "token",
        cookie: "c_user=1",
    }), { code: "FACEBOOK_ACCOUNT_KEY_DUPLICATE" });

    await manager.update("client_1", {
        userAgent: "",
        accessToken: "new-token",
        cookie: "",
    });
    const persistedAfterUpdate = JSON.parse(
        await readFile(accountsFile, "utf8")
    ).accounts[0];
    assert.equal(persistedAfterUpdate.userAgent, "Mozilla/5.0 Test");
    assert.equal(persistedAfterUpdate.accessToken, "new-token");
    assert.equal(persistedAfterUpdate.cookie, "c_user=100; xs=session=value");

    const archived = await manager.setArchived("client_1", true);
    assert.equal(archived.archived, true);
    assert.equal((await manager.list())[0].archived, true);
    assert.equal(
        JSON.parse(await readFile(accountsFile, "utf8")).accounts[0].archived,
        true
    );

    const removedArchived = await manager.deleteArchived();
    assert.deepEqual(
        removedArchived.map((account) => account.accountKey),
        ["client_1"]
    );
    assert.deepEqual(
        (await manager.list()).map((account) => account.accountKey),
        ["client_2"]
    );

    const removed = await manager.delete("client_2");
    assert.equal(removed.accountKey, "client_2");
    assert.deepEqual(await manager.list(), []);

    console.log("Перевірка менеджера Facebook-акаунтів пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
