import AutouploadTab from "../tabs/AutouploadTab.jsx";

// Лише вигадані дані для візуальної перевірки таблиці, без доступу до AdsPower.
const initial = {
    groups: [{ id: "new", name: "Нові" }, { id: "work", name: "У роботі" }],
    profiles: [
        { profileId: "demo-one", profileNo: "1001", name: "Основний профіль · Україна", groupId: "work", status: "active", message: "Акаунт перевірено", adsPowerOpen: true,
            assets: { adAccountsState: "loaded", pagesState: "loaded", adAccounts: [{ id: "act_100001", accountId: "100001", name: "Основний РК", accountStatus: 1 }, { id: "act_100002", accountId: "100002", name: "Резервний РК", accountStatus: 2 }], pages: [{ id: "200001", name: "Міські історії" }, { id: "200002", name: "Подорожі поруч" }] } },
        { profileId: "demo-two", profileNo: "1002", name: "Робочий профіль · Польща", groupId: "new", status: "login_required", message: "Потрібна повторна авторизація", assets: { adAccounts: [], pages: [] } },
        { profileId: "demo-three", profileNo: "1003", name: "Новий профіль", groupId: "new", status: "unchecked", assets: { adAccounts: [], pages: [] } },
    ], history: [],
};
const ok = (data) => Promise.resolve({ ok: true, data });

export default function AutouploadShowcase() {
    window.adsBot = {
        getAutoupload: () => ok(initial), onAutouploadUpdated: () => () => {},
        controlAutouploadProfile: (profileId, action) => ok({ profileId, adsPowerOpen: action === "open" }),
        checkAutouploadSessions: () => ok({ taskId: "preview" }),
    };
    return <main className="autoupload-showcase"><AutouploadTab /></main>;
}
