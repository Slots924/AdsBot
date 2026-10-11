import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar.jsx";
import prepareAccountProfileProxy from "../../../services/proxy/prepareAccountProfileProxy.js";
import { getAccountProxyMode, normalizeAccountProxySettings } from "../../../services/proxy/accountProxyMode.js";

afterEach(cleanup);

const proxies = [{ id: "p1", name: "Перша", type: "http", host: "example.com", port: "8080" },
    { id: "p2", name: "Друга", type: "http", host: "example.org", port: "8080", isPublic: false }];
const show = (accounts = []) => render(<Sidebar standalone accounts={accounts} proxies={proxies}
    selectedAccountKey="" loading={false} onSelect={vi.fn()} onRefresh={vi.fn()}
    onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onError={vi.fn()} />);

describe("Режим проксі клієнта", () => {
    it.each(["API-клієнти", "BM"])("новий %s використовує проксі профілю", (kind) => {
        show();
        fireEvent.click(screen.getByRole("radio", { name: kind }));
        fireEvent.click(screen.getByTitle("Додати акаунт"));
        expect(screen.getByRole("radio", { name: "Проксі профілю" })).toBeChecked();
        expect(screen.getByRole("radio", { name: "Автоматично" })).not.toBeChecked();
        expect(screen.queryByRole("combobox", { name: "Прив’язана проксі" })).not.toBeInTheDocument();
    });

    it("прив’язка вимагає ручного вибору зі списку поверх модального вікна", () => {
        const { container } = show();
        fireEvent.click(screen.getByTitle("Додати акаунт"));
        fireEvent.click(screen.getByRole("radio", { name: "Прив’язати проксі" }));
        fireEvent.focus(screen.getByRole("combobox", { name: "Прив’язана проксі" }));
        expect(container.querySelector('[role="listbox"]')).toBeNull();
        fireEvent.click(screen.getByRole("option", { name: "Друга · p2" }));
        expect(screen.getByRole("combobox", { name: "Прив’язана проксі" })).toHaveValue("Друга · p2");
        expect(screen.getByText("Новий клієнт")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("radio", { name: "Автоматично" }));
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("зберігає попередній режим наявного клієнта", () => {
        show([{ accountKey: "account-001", kind: "api", name: "Клієнт", proxyId: "p1" }]);
        fireEvent.click(screen.getByTitle("Редагувати"));
        expect(screen.getByRole("radio", { name: "Прив’язати проксі" })).toBeChecked();
        expect(getAccountProxyMode({})).toBe("auto");
        expect(normalizeAccountProxySettings({})).toEqual({ proxyMode: "profile", proxyId: "" });
        expect(() => normalizeAccountProxySettings({ proxyMode: "bound" })).toThrow();
    });

    it("показує стан проксі профілю без її реквізитів", () => {
        show([{ accountKey: "account-001", kind: "api", name: "Клієнт", adsPowerProfileNo: "123",
            proxyMode: "profile", hasAdsPowerProxy: true, adsPowerProxyUpdatedAt: "2026-10-11T00:00:00Z" }]);
        fireEvent.click(screen.getByTitle("Редагувати"));
        expect(screen.getByText(/Проксі отримана · оновлено/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/AdsPower №/), { target: { value: "456" } });
        expect(screen.getByText("Проксі буде отримана перед першим запитом")).toBeInTheDocument();
    });
});

describe("Проксі під час запуску профілю", () => {
    const dependencies = () => ({
        adsPower: { getProfileByNo: vi.fn().mockResolvedValue({ profile_id: "ads1" }),
            getCloudProfileStatus: vi.fn().mockResolvedValue([]), updateProfileProxy: vi.fn() },
        proxyManager: { list: vi.fn().mockResolvedValue(proxies),
            getById: vi.fn(async (id) => proxies.find((proxy) => proxy.id === id)) },
        checkProxyFn: vi.fn().mockResolvedValue({ working: true }),
    });

    it("залишає проксі профілю без перевірки пулу й заміни", async () => {
        const deps = dependencies();
        await prepareAccountProfileProxy({ proxyMode: "profile" }, deps);
        expect(deps.proxyManager.list).not.toHaveBeenCalled();
        expect(deps.adsPower.updateProfileProxy).not.toHaveBeenCalled();
    });

    it("автоматично вибирає лише загальнодоступну робочу проксі", async () => {
        const deps = dependencies();
        await prepareAccountProfileProxy({ proxyMode: "auto", adsPowerProfileNo: "123" }, deps);
        expect(deps.checkProxyFn).toHaveBeenCalledTimes(1);
        expect(deps.adsPower.updateProfileProxy).toHaveBeenCalledWith("ads1", expect.objectContaining({ proxy_host: "example.com" }));
    });

    it("не підміняє недоступну прив’язану проксі іншою", async () => {
        const deps = dependencies();
        deps.checkProxyFn.mockResolvedValue({ working: false });
        await expect(prepareAccountProfileProxy({ proxyMode: "bound", proxyId: "p2", adsPowerProfileNo: "123" }, deps)).rejects.toThrow("Прив’язана проксі не працює");
        expect(deps.proxyManager.list).not.toHaveBeenCalled();
        expect(deps.checkProxyFn).toHaveBeenCalledTimes(1);
        expect(deps.adsPower.updateProfileProxy).not.toHaveBeenCalled();
    });

    it("не змінює проксі вже відкритого профілю", async () => {
        const deps = dependencies();
        deps.adsPower.getCloudProfileStatus.mockResolvedValue([{ user_id: "ads1" }]);
        await expect(prepareAccountProfileProxy({ proxyMode: "auto", adsPowerProfileNo: "123" }, deps)).rejects.toThrow("Закрийте AdsPower-профіль");
        expect(deps.adsPower.updateProfileProxy).not.toHaveBeenCalled();
    });
});
