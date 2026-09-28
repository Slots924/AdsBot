import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function cardError(message, code) {
    return Object.assign(new Error(message), { code });
}


function passesLuhn(number) {
    let sum = 0;
    let doubleDigit = false;
    for (let index = number.length - 1; index >= 0; index -= 1) {
        let digit = Number(number[index]);
        if (doubleDigit) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
}


function normalize(input = {}) {
    const nickname = String(input.nickname ?? "").trim();
    const cardholderName = String(input.cardholderName ?? "").trim();
    const cardNumber = String(input.cardNumber ?? "").replace(/[\s-]/g, "");
    const expiration = String(input.expiration ?? "").trim();
    const postalCode = String(input.postalCode ?? "").trim();
    const countryCode = String(input.countryCode ?? "US").trim().toUpperCase();
    if (!nickname || !cardholderName || !/^\d{12,19}$/.test(cardNumber)
        || !passesLuhn(cardNumber)
        || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiration)
        || !/^[A-Z]{2}$/.test(countryCode)) {
        throw cardError(
            "Потрібні нікнейм, ім'я власника, коректний номер, строк MM/YY і countryCode",
            "CREDIT_CARD_INVALID"
        );
    }
    return { nickname, cardholderName, cardNumber, expiration, postalCode, countryCode };
}


function detectNetwork(number) {
    if (/^4/.test(number)) return "VISA";
    if (/^(5[1-5]|2[2-7])/.test(number)) return "MASTERCARD";
    if (/^3[47]/.test(number)) return "AMEX";
    return "CARD";
}


function publicCard(card) {
    return {
        id: card.id,
        nickname: card.nickname,
        cardholderName: card.cardholderName,
        expiration: card.expiration,
        postalCode: card.postalCode,
        countryCode: card.countryCode,
        network: card.network,
        last4: card.last4,
        displayNumber: `${card.bin || ""}••••••${card.last4}`,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
    };
}


export default class CreditCardStore {
    #operation = Promise.resolve();


    constructor({ cardsFile, encrypt, decrypt } = {}) {
        if (!cardsFile || typeof encrypt !== "function" || typeof decrypt !== "function") {
            throw new Error("Не передано файл або encryption adapter для кредитних карт");
        }
        this.cardsFile = path.resolve(cardsFile);
        this.encrypt = encrypt;
        this.decrypt = decrypt;
    }


    list() {
        return this.#enqueue(async () => (await this.#read()).cards
            .map(publicCard)
            .sort((left, right) => left.nickname.localeCompare(right.nickname, "uk-UA", {
                sensitivity: "base",
                numeric: true,
            })));
    }


    create(input) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const value = normalize(input);
            const now = new Date().toISOString();
            const card = {
                id: randomUUID(),
                nickname: value.nickname,
                cardholderName: value.cardholderName,
                expiration: value.expiration,
                postalCode: value.postalCode,
                countryCode: value.countryCode,
                encryptedNumber: this.encrypt(value.cardNumber),
                bin: value.cardNumber.slice(0, 6),
                last4: value.cardNumber.slice(-4),
                network: detectNetwork(value.cardNumber),
                createdAt: now,
                updatedAt: now,
            };
            store.cards.push(card);
            await this.#write(store);
            return publicCard(card);
        });
    }


    update(id, input) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const card = store.cards.find((item) => item.id === String(id));
            if (!card) throw cardError("Кредитну карту не знайдено", "CREDIT_CARD_NOT_FOUND");
            const existingNumber = this.decrypt(card.encryptedNumber);
            const value = normalize({
                ...card,
                ...input,
                cardNumber: input.cardNumber || existingNumber,
            });
            Object.assign(card, {
                nickname: value.nickname,
                cardholderName: value.cardholderName,
                expiration: value.expiration,
                postalCode: value.postalCode,
                countryCode: value.countryCode,
                encryptedNumber: this.encrypt(value.cardNumber),
                bin: value.cardNumber.slice(0, 6),
                last4: value.cardNumber.slice(-4),
                network: detectNetwork(value.cardNumber),
                updatedAt: new Date().toISOString(),
            });
            await this.#write(store);
            return publicCard(card);
        });
    }


    remove(id) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const index = store.cards.findIndex((item) => item.id === String(id));
            if (index < 0) throw cardError("Кредитну карту не знайдено", "CREDIT_CARD_NOT_FOUND");
            const [removed] = store.cards.splice(index, 1);
            await this.#write(store);
            return publicCard(removed);
        });
    }


    getForUse(id) {
        return this.#enqueue(async () => {
            const card = (await this.#read()).cards.find((item) => item.id === String(id));
            if (!card) throw cardError("Кредитну карту не знайдено", "CREDIT_CARD_NOT_FOUND");
            return { ...publicCard(card), cardNumber: this.decrypt(card.encryptedNumber) };
        });
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.cardsFile, "utf8"));
            return { cards: Array.isArray(parsed?.cards) ? parsed.cards : [] };
        } catch (error) {
            if (error.code === "ENOENT") return { cards: [] };
            throw error;
        }
    }


    async #write(store) {
        await mkdir(path.dirname(this.cardsFile), { recursive: true });
        const temporary = `${this.cardsFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        await rename(temporary, this.cardsFile);
    }
}
