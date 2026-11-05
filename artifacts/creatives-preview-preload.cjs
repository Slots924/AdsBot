const ok = (data) => Promise.resolve({ ok: true, data });
const fixture = {
    loadAppState: () => ok({ activeTab: "creatives", uiScale: 1, taskPanelCollapsed: true, keitaroAvailableGroupIds: [], selectedAccountKey: "", selectedAdAccountId: "", selectedPageId: "" }),
    getCreatives: () => ok(["1", "4", "17", "25", "28", "138", "202"].map((name) => ({ name, hasOriginal: true, countries: ["AT", "DE", "GB", "US", "UA"] }))),
    getCountries: () => ok([{ code: "UA", name: "Ukraine" }, { code: "US", name: "United States" }]),
    getCreativeOriginal: () => ok({ text: "Текст оригіналу креативу.\n\nТут можна переглянути та відредагувати основний текст перед підготовкою версій для різних країн." }),
    getCreativeVariant: () => ok({ creative: "Текст креативу для України.\n\nГотова версія, яку можна редагувати незалежно від оригіналу.", comments: [] }),
};
window.adsBot = new Proxy(fixture, { get: (target, key) => target[key] || (String(key).startsWith("on") ? () => () => {} : () => ok([])) });
