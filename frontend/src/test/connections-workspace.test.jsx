import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar.jsx";
import ProxyStrip from "../components/ProxyStrip.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clients = [{ accountKey: "account-001", name: "Без профілю", kind: "api", tokenMode: "access", hasAfpToken: true }, { accountKey: "account-002", name: "З профілем", kind: "api", adsPowerProfileNo: "123", tokenMode: "afp", hasAfpToken: true }];
const proxies = [{ id: "p1", name: "Public", type: "socks5", isPublic: true, adsPowerId: 1 }, { id: "p2", name: "Private", type: "http", isPublic: false, adsPowerId: 2 }, { id: "p3", name: "Legacy public", type: "http" }];

describe("Робочий простір підключень", () => {
    it("показує неактивний запуск без профілю та перевіряє токен окремо від списку", async () => {
        const onCheck = vi.fn().mockResolvedValue();
        const onRefresh = vi.fn();
        const onOpenProfile = vi.fn().mockResolvedValue();
        const onSelect = vi.fn();
        render(<Sidebar standalone accounts={clients} onCheck={onCheck} onRefresh={onRefresh} onOpenProfile={onOpenProfile} onSelect={onSelect} onError={vi.fn()} />);
        const cards = document.querySelectorAll(".connection-card");
        const empty = within(cards[0]);
        const linked = within(cards[1]);
        expect(empty.getByRole("button", { name: "Відкрити AdsPower-профіль" })).toBeDisabled();
        expect(linked.getByRole("button", { name: "Відкрити AdsPower-профіль" })).toBeEnabled();
        fireEvent.click(empty.getByTitle("Перевірити, чи працює API-клієнт"));
        await waitFor(() => expect(onCheck).toHaveBeenCalledWith("account-001"));
        expect(onRefresh).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.click(linked.getByRole("button", { name: "Відкрити AdsPower-профіль" }));
        await waitFor(() => expect(onOpenProfile).toHaveBeenCalledWith("account-002"));
        fireEvent.click(screen.getByTitle("Оновити акаунти"));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("фільтрує проксі та повертає повний порядок без втрати прихованих записів", () => {
        const onReorder = vi.fn();
        render(<ProxyStrip proxies={proxies} onReorder={onReorder} onError={vi.fn()} />);
        expect(screen.getAllByTitle("Змінити порядок")).toHaveLength(3);
        fireEvent.click(screen.getByRole("button", { name: /Приватні/ }));
        expect(screen.getByText("Private")).toBeInTheDocument();
        expect(screen.queryByText("Public")).not.toBeInTheDocument();
        expect(screen.queryByTitle("Змінити порядок")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Публічні/ }));
        expect(screen.getByText("Public")).toBeInTheDocument();
        expect(screen.getByText("Legacy public")).toBeInTheDocument();
        expect(screen.queryByText("Private")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Усі/ }));
        expect([...document.querySelectorAll(".proxy-card strong")].map((item) => item.textContent)).toEqual(proxies.map((proxy) => proxy.name));
        expect(screen.getAllByTitle("Змінити порядок")).toHaveLength(3);
        expect(onReorder).not.toHaveBeenCalled();
    });

    it("оновлює публічність у фільтрі та показує порожній стан", async () => {
        function PublicityPreview() {
            const [items, setItems] = useState([proxies[1]]);
            return <ProxyStrip proxies={items} onUpdate={async (id, patch) => setItems((current) => current.map((proxy) => proxy.id === id ? { ...proxy, ...patch } : proxy))} onError={vi.fn()} />;
        }
        render(<PublicityPreview />);
        fireEvent.click(screen.getByRole("button", { name: /Приватні/ }));
        fireEvent.click(screen.getByRole("switch", { name: "Загальнодоступна" }));
        await waitFor(() => expect(screen.queryByText("Private")).not.toBeInTheDocument());
        expect(screen.getByText("У цій категорії немає проксі.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Публічні/ }));
        expect(screen.getByText("Private")).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Загальнодоступна" })).toBeChecked();
    });

    it("не застосовує фільтри управління в селекторі проксі й не вибирає картку при дії", async () => {
        const onCheck = vi.fn().mockResolvedValue({ working: true });
        const onSelect = vi.fn();
        render(<ProxyStrip variant="picker" selectable proxies={[proxies[0]]} onCheck={onCheck} onSelect={onSelect} onError={vi.fn()} />);
        expect(screen.queryByRole("group", { name: "Доступність проксі" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByTitle("Перевірити статус"));
        await waitFor(() => expect(onCheck).toHaveBeenCalledWith("p1"));
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Public"));
        expect(onSelect).toHaveBeenCalledWith("p1");
    });

    it("залишає синхронізацію, оновлення IP, редагування та видалення проксі робочими", async () => {
        const onSync = vi.fn().mockResolvedValue();
        const onRefreshIp = vi.fn().mockResolvedValue({ working: true });
        const onGet = vi.fn().mockResolvedValue({ ...proxies[0], host: "example.com", port: "8080" });
        const onDelete = vi.fn().mockResolvedValue();
        const onRefresh = vi.fn();
        vi.spyOn(window, "confirm").mockReturnValue(true);
        render(<ProxyStrip proxies={[{ ...proxies[0], hasRefreshUrl: true }]} onSync={onSync} onRefreshIp={onRefreshIp} onGet={onGet} onDelete={onDelete} onRefresh={onRefresh} onError={vi.fn()} />);
        fireEvent.click(screen.getByTitle("Синхронізувати з AdsPower"));
        await waitFor(() => expect(onSync).toHaveBeenCalledWith("p1"));
        await waitFor(() => expect(screen.getByTitle("Синхронізувати з AdsPower")).toBeEnabled());
        fireEvent.click(screen.getByTitle("Оновити IP"));
        await waitFor(() => expect(onRefreshIp).toHaveBeenCalledWith("p1"));
        fireEvent.click(screen.getByTitle("Редагувати"));
        await waitFor(() => expect(onGet).toHaveBeenCalledWith("p1"));
        expect(await screen.findByLabelText("Хост")).toHaveValue("example.com");
        fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
        fireEvent.click(screen.getByTitle("Видалити"));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith("p1"));
        fireEvent.click(screen.getByTitle("Оновити список проксі"));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});
