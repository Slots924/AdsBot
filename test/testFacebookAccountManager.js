import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

    await writeFile(accountsFile, JSON.stringify({
        accounts: [{
            accountKey: "legacy_client",
            name: "Old display name",
            userAgent: "legacy-agent",
            accessToken: "legacy-token",
            cookie: "c_user=1; xs=2",
        }],
    }));
    const migrated = await manager.migrateLegacyAccountKeys();
    assert.equal(migrated[0].accountKey, "account-001");
    assert.equal(migrated[0].name, "legacy_client");

    const created = await manager.create({
        name: "Client 1",
        userAgent: "Mozilla/5.0 Test",
        accessToken: "secret-token",
        cookie: adsPowerCookies,
    });
    assert.equal(created.accountKey, "account-002");
    assert.equal(created.name, "Client 1");
    assert.equal(created.archived, false);
    assert.equal(created.hasAccessToken, true);
    assert(!("accessToken" in created));
    assert(!("cookie" in created));

    const adspowerOnly = await manager.create({
        name: "Client 2",
        adsPowerProfileNo: "1791",
    });
    assert.equal(adspowerOnly.accountKey, "account-003");
    assert.equal(adspowerOnly.adsPowerProfileNo, "1791");
    assert.equal(adspowerOnly.hasAccessToken, false);

    const updatedWithoutCredentials = await manager.update("account-003", {
        name: "Client 2 updated",
        adsPowerProfileNo: "1792",
    });
    assert.equal(updatedWithoutCredentials.name, "Client 2 updated");
    assert.equal(updatedWithoutCredentials.adsPowerProfileNo, "1792");

    const updatedProfileNo = await manager.update("account-003", {
        adsPowerProfileNo: "1758",
    });
    assert.equal(updatedProfileNo.adsPowerProfileNo, "1758");

    await assert.rejects(manager.create({
        name: "",
        adsPowerProfileNo: "1793",
    }), { code: "FACEBOOK_ACCOUNT_NAME_REQUIRED" });

    await manager.update("account-002", {
        name: "Client 1",
        userAgent: "",
        accessToken: "new-token",
        cookie: "",
    });
    const persistedAfterUpdate = JSON.parse(
        await readFile(accountsFile, "utf8")
    ).accounts[1];
    assert.equal(persistedAfterUpdate.userAgent, "Mozilla/5.0 Test");
    assert.equal(persistedAfterUpdate.accessToken, "new-token");
    assert.equal(persistedAfterUpdate.cookie, "c_user=100; xs=session=value");

    const archived = await manager.setArchived("account-002", true);
    assert.equal(archived.archived, true);
    assert.equal((await manager.list())[1].archived, true);
    assert.equal(
        JSON.parse(await readFile(accountsFile, "utf8")).accounts[1].archived,
        true
    );

    const removedArchived = await manager.deleteArchived();
    assert.deepEqual(
        removedArchived.map((account) => account.accountKey),
        ["account-002"]
    );
    assert.deepEqual(
        (await manager.list()).map((account) => account.accountKey),
        ["account-001", "account-003"]
    );

    const removed = await manager.delete("account-003");
    assert.equal(removed.accountKey, "account-003");
    const createdAfterDeletion = await manager.create({
        name: "Client 3",
        adsPowerProfileNo: "1793",
    });
    assert.equal(createdAfterDeletion.accountKey, "account-004");
    assert.deepEqual(
        (await manager.list()).map((account) => account.accountKey),
        ["account-001", "account-004"]
    );

    console.log("Перевірка менеджера Facebook-акаунтів пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
