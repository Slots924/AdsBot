import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import CreditCardStore from "../services/personalAccounts/CreditCardStore.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-cards-"));
try {
    const file = path.join(directory, "cards.json");
    const store = new CreditCardStore({
        cardsFile: file,
        encrypt: (value) => Buffer.from(`protected:${value}`).toString("base64"),
        decrypt: (value) => Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, ""),
    });
    const created = await store.create({
        nickname: "Myraha 1",
        cardholderName: "Test Owner",
        cardNumber: "5555555555554444",
        expiration: "09/28",
        postalCode: "",
        countryCode: "US",
    });
    assert.equal(created.nickname, "Myraha 1");
    assert.equal(created.last4, "4444");
    assert.equal(created.network, "MASTERCARD");
    assert.equal("cardNumber" in created, false);
    assert.equal((await readFile(file, "utf8")).includes("5555555555554444"), false);

    const updated = await store.update(created.id, {
        nickname: "Myraha 2",
        cardholderName: "Test Owner",
        cardNumber: "",
        expiration: "10/29",
        postalCode: "10001",
        countryCode: "US",
    });
    assert.equal(updated.nickname, "Myraha 2");
    assert.equal((await store.getForUse(created.id)).cardNumber, "5555555555554444");
    assert.equal((await store.list()).length, 1);
    await assert.rejects(() => store.create({
        nickname: "Invalid",
        cardholderName: "Test Owner",
        cardNumber: "5555555555554445",
        expiration: "09/28",
        countryCode: "US",
    }), (error) => error.code === "CREDIT_CARD_INVALID");
    await store.remove(created.id);
    assert.equal((await store.list()).length, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Перевірка зашифрованого сховища кредитних карт пройшла успішно");
