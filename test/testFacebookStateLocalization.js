import assert from "node:assert/strict";
import {
    facebookTranslations,
    getFacebookTexts,
    supportedFacebookLanguages,
} from "../facebook/i18n/index.js";
import { accountRecovery } from "../facebook/selectors/accountRecovery.js";
import { inspectRecoveryInPage } from "../facebook/state/detectAccountRecoveryStep.js";
import detectLoginStatus from "../facebook/state/detectLoginStatus.js";
import isReady from "../facebook/state/checks/isReady.js";
import isAutomatedBehavior from "../facebook/state/checks/isAutomatedBehavior.js";

const fixtures = {
    en: { profile: "Your profile", create: "Create new account", email: "Get a code by email" },
    uk: { profile: "Ваш профіль", create: "Створити новий обліковий запис", email: "Отримати код електронною поштою" },
    ru: { profile: "Ваш профиль", create: "Создать новый аккаунт", email: "Получить код по электронной почте" },
    de: { profile: "Dein Profil", create: "Neues Konto erstellen", email: "Code per E-Mail erhalten" },
    fr: { profile: "Votre profil", create: "Créer un nouveau compte", email: "Recevoir un code par e-mail" },
    es: { profile: "Tu perfil", create: "Crear cuenta nueva", email: "Recibir un código por correo electrónico" },
    hi: { profile: "आपकी प्रोफ़ाइल", create: "नया अकाउंट बनाएँ", email: "ईमेल से कोड पाएँ" },
    tr: { profile: "Profilin", create: "Yeni hesap oluştur", email: "E-postayla kod al" },
    id: { profile: "Profil Anda", create: "Buat akun baru", email: "Dapatkan kode melalui email" },
};

assert.deepEqual(supportedFacebookLanguages, Object.keys(fixtures));
function keysOf(entry, prefix = "") {
    return Object.entries(entry).flatMap(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        return Array.isArray(value) ? [name] : keysOf(value, name);
    });
}
const keys = keysOf(facebookTranslations.en);
for (const language of supportedFacebookLanguages) {
    assert.deepEqual(keysOf(facebookTranslations[language]), keys, language);
}
for (const key of keys) assert(getFacebookTexts(key).length > 0, key);
assert.throws(() => getFacebookTexts("account.missing"), /Відсутні мовні варіанти/);

// Мінімальний DOM виконує справжні функції перевірок, включно з CSS-відбором та видимістю.
function node(tag = "div", attrs = {}, text = "", options = {}) {
    return {
        tagName: tag.toUpperCase(), attrs, innerText: text, textContent: text,
        value: attrs.value ?? "", isConnected: true, disabled: options.disabled ?? false,
        hidden: options.hidden ?? false,
        getAttribute: (name) => attrs[name] ?? null,
        closest: () => null,
        getBoundingClientRect: () => ({ width: options.hidden ? 0 : 100, height: 30 }),
        querySelectorAll(selector) { return select(options.children ?? [], selector); },
    };
}
function select(nodes, selector) {
    const asciiLower = (text) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    return nodes.filter((element) => selector.split(",").some((part) => {
        const fragment = part.trim();
        const tag = fragment.match(/^[a-z0-9]+/i)?.[0];
        if (tag && element.tagName !== tag.toUpperCase()) return false;
        return [...fragment.matchAll(/\[([^\]=]+)(?:="([^"]*)"( i)?)?\]/g)].every(([, attr, value, insensitive]) => {
            const actual = element.getAttribute(attr);
            if (actual === null) return false;
            if (value === undefined) return true;
            return insensitive ? asciiLower(actual) === asciiLower(value) : actual === value;
        });
    }));
}
const globalNames = ["document", "location", "getComputedStyle", "window"];
const previous = Object.fromEntries(globalNames.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
function mount(nodes, url = "https://www.facebook.com/", body = nodes.map((entry) => entry.innerText).join(" ")) {
    globalThis.document = {
        body: { innerText: body }, readyState: "complete",
        querySelectorAll: (selector) => select(nodes, selector),
    };
    globalThis.location = { href: url };
    globalThis.getComputedStyle = (element) => ({
        display: element.hidden ? "none" : "block", visibility: "visible", opacity: "1",
    });
    globalThis.window = { getComputedStyle: globalThis.getComputedStyle };
    return {
        url: () => url,
        evaluate: async (callback, ...args) => callback(...args),
    };
}
const varied = (text) => `  ${text.replace(/ß/g, "ẞ").toUpperCase().replace(/ /g, "  ")}  `;
const inspect = () => inspectRecoveryInPage(accountRecovery);
const main = () => node("div", { role: "main" });
const profile = (text, options) => node("div", { role: "button", "aria-label": text }, "", options);
const button = (text, options) => node("button", {}, text, options);
const recoveryUrl = "https://www.facebook.com/checkpoint/828281030927956/";

try {
    for (const [language, fixture] of Object.entries(fixtures)) {
        const texts = facebookTranslations[language];
        let page = mount([profile(varied(fixture.profile)), main()]);
        assert.equal(inspect().step, "AUTHENTICATED", `${language}: профіль з іншим регістром`);
        assert.equal(await isReady(page), true, language);

        const create = node("a", { "aria-label": varied(fixture.create) });
        page = mount([create, profile(fixture.profile), main()]);
        assert.equal(inspect().step, "LOGIN", language);
        assert.equal(await isReady(page), false, language);
        assert.equal(await detectLoginStatus(page), "LOGGED_OUT", `${language}: видима кнопка входу`);
        page = mount([node("a", { "aria-label": fixture.create }, "", { hidden: true }), profile(fixture.profile), main()]);
        assert.equal(await detectLoginStatus(page), "LOGGED_IN", `${language}: прихована кнопка входу`);

        const email = button(varied(fixture.email));
        mount([email], recoveryUrl);
        assert.equal(inspect().step, "CHOOSE_RECOVERY_METHOD", language);
        assert.deepEqual(inspect().availableMethods, ["email"], language);
        assert.equal(inspectRecoveryInPage(accountRecovery, "email"), email, language);
        mount([button(fixture.email, { disabled: true })], recoveryUrl);
        assert.equal(inspect().emailAvailable, false, language);
        assert.equal(inspectRecoveryInPage(accountRecovery, "email"), null, language);

        for (const method of ["phone", "whatsapp"]) {
            mount([button(varied(texts.recovery[method][0]))], recoveryUrl);
            assert.deepEqual(inspect().availableMethods, [method], `${language}: ${method}`);
        }
        mount([button(varied(texts.recovery.start[0]))], recoveryUrl);
        assert.equal(inspect().step, "GET_STARTED", language);
        mount([profile(fixture.profile), main(), button(texts.recovery.start[0])]);
        assert.equal(inspect().step, "AUTHENTICATED", `${language}: початок у стрічці не є recovery`);

        for (const action of ["next", "save", "back"]) {
            const control = button(varied(texts.recovery[action][0]));
            mount([control], recoveryUrl);
            assert.equal(inspectRecoveryInPage(accountRecovery, action), control, `${language}: ${action}`);
        }
        for (const heading of ["newPassword", "currentPassword", "code"]) {
            mount([
                node("h1", {}, varied(texts.recovery[heading][0])),
                node("input", { type: heading === "code" ? "text" : "password" }),
            ], recoveryUrl);
            assert.equal(inspect().step, {
                newPassword: "NEW_PASSWORD", currentPassword: "CURRENT_PASSWORD", code: "CONFIRMATION_CODE",
            }[heading], `${language}: ${heading}`);
        }
        mount([node("div", { role: "dialog" }, varied(texts.recovery.protection[0]))]);
        assert.equal(inspect().step, "PROTECTION_DIALOG", language);
        mount([], recoveryUrl, varied(texts.recovery.codeErrors[0]));
        assert.equal(inspect().codeRejected, true, language);
        mount([], recoveryUrl, varied(texts.recovery.passwordErrors[0]));
        assert.equal(inspect().passwordRejected, true, language);

        page = mount([node("span", {}, varied(texts.automatedBehavior.warning[0]))], recoveryUrl);
        assert.equal(await isAutomatedBehavior(page), true, `${language}: automated behavior`);
    }

    mount([profile("Ваш профиль", { hidden: true }), main()]);
    assert.equal(inspect().step, "UNKNOWN");
    mount([profile("Невідома кнопка"), main()]);
    assert.equal(inspect().step, "UNKNOWN");
    mount([profile("Ваш профиль")]);
    assert.equal(inspect().step, "UNKNOWN");
    mount([profile("Ваш профиль"), main(), node("input", { type: "password" })]);
    assert.equal(inspect().authenticated, false);
    for (const path of ["checkpoint/123", "login", "recover", "confirmemail"]) {
        mount([profile("Ваш профиль"), main()], `https://www.facebook.com/${path}`);
        assert.equal(inspect().authenticated, false, path);
    }
    let page = mount([profile("Your profile"), main()], "https://adsmanager.facebook.com/adsmanager/manage/campaigns");
    assert.equal(await isReady(page), false);
    page = mount([node("span", {}, "Звичайний текст")], recoveryUrl);
    assert.equal(await isAutomatedBehavior(page), false);
    mount([button("Отримати код електронною поштою")], "https://www.facebook.com/");
    assert.deepEqual(inspect().availableMethods, []);
    assert.equal(inspect().step, "UNKNOWN");
} finally {
    for (const key of globalNames) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
        else delete globalThis[key];
    }
}

console.log("Перевірки мовної підтримки Facebook пройшли для всіх дев'яти мов");
