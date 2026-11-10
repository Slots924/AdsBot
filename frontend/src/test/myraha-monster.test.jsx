import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useMyrahaMonster from "../lib/useMyrahaMonster.js";
import MyrahaMonsterToggle from "../components/MyrahaMonsterToggle.jsx";
import IntegrationsSettings from "../components/IntegrationsSettings.jsx";

const ok = (data) => ({ ok: true, data });
const page = (id, enabled = false, integrationReady = true) => ({ id, enabled, integrationReady });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let settingsChanged;

function Harness() {
    const moderation = useMyrahaMonster();
    return <div>
        <button onClick={moderation.refresh}>Оновити інтеграцію</button>
        {["1", "2", "3"].map((id) => <MyrahaMonsterToggle key={id} pageId={id} moderation={moderation} />)}
    </div>;
}

beforeEach(() => {
    window.adsBot = {
        getMyrahaMonsterSettings: vi.fn(async () => ok({ baseUrl: "https://myrahamonster.xyz/api/v1", hasApiKey: true, revision: 1 })),
        getMyrahaMonsterPages: vi.fn(async () => ok({ items: [page("1"), page("2")], revision: 1 })),
        setMyrahaMonsterModeration: vi.fn(async (id, enabled) => ok({ id, enabled, revision: 1 })),
        getMyrahaMonsterPage: vi.fn(async (id) => ok({ ...page(id, true), revision: 1 })),
        onMyrahaMonsterSettingsChanged: vi.fn((callback) => { settingsChanged = callback; return vi.fn(); }),
        saveMyrahaMonsterSettings: vi.fn(async () => ok({ baseUrl: "https://myrahamonster.xyz/api/v1", hasApiKey: true, revision: 2 })),
    };
});
afterEach(cleanup);
const toggle = (id) => screen.getByRole("switch", { name: `Приховування коментарів ${id}` });
const ready = () => waitFor(() => expect(toggle("1")).toBeEnabled());

it("показує enabled, відсутність доступу та підписки окремо", async () => {
    window.adsBot.getMyrahaMonsterPages.mockResolvedValue(ok({ items: [page("1", true), page("2", true, false)], revision: 1 }));
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    expect(toggle("1")).toBeChecked();
    expect(toggle("2")).toBeChecked();
    expect(toggle("2")).toBeDisabled();
    expect(toggle("3")).toBeDisabled();
    expect(screen.getByText("Немає доступної підписки MyrahaMonster")).toBeInTheDocument();
    expect(screen.getByText("Немає доступу до фанпейджі в MyrahaMonster")).toBeInTheDocument();
});

it("показує спінер лише для активної фанки та відправляє різні запити паралельно", async () => {
    const first = deferred();
    const second = deferred();
    window.adsBot.setMyrahaMonsterModeration.mockImplementation((id) => id === "1" ? first.promise : second.promise);
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    expect(toggle("1")).toBeDisabled();
    expect(toggle("1")).not.toBeChecked();
    expect(screen.getByRole("status", { name: "Запит MyrahaMonster 1" })).toBeInTheDocument();
    expect(toggle("2")).toBeEnabled();
    fireEvent.click(toggle("1"));
    fireEvent.click(toggle("2"));
    expect(window.adsBot.setMyrahaMonsterModeration.mock.calls).toEqual([["1", true], ["2", true]]);
    await act(async () => { first.resolve(ok({ id: "1", enabled: true, revision: 1 })); second.resolve(ok({ id: "2", enabled: true, revision: 1 })); });
    expect(toggle("1")).toBeChecked();
    expect(toggle("2")).toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("старе завантаження списку не перезаписує результат перемикання", async () => {
    const patch = deferred();
    const list = deferred();
    window.adsBot.setMyrahaMonsterModeration.mockReturnValue(patch.promise);
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    window.adsBot.getMyrahaMonsterPages.mockReturnValue(list.promise);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await waitFor(() => expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(2));
    await act(async () => { patch.resolve(ok({ id: "1", enabled: true, revision: 1 })); });
    await act(async () => { list.resolve(ok({ items: [page("1"), page("2")], revision: 1 })); });
    expect(toggle("1")).toBeChecked();
});

it("відповідь для попереднього ключа не змінює новий стан", async () => {
    const patch = deferred();
    window.adsBot.setMyrahaMonsterModeration.mockReturnValue(patch.promise);
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    window.adsBot.getMyrahaMonsterSettings.mockResolvedValue(ok({ hasApiKey: true, revision: 2 }));
    window.adsBot.getMyrahaMonsterPages.mockResolvedValue(ok({ items: [page("1")], revision: 2 }));
    await act(async () => { settingsChanged(); });
    expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    await act(async () => { patch.resolve(ok({ id: "1", enabled: true, revision: 1 })); });
    expect(toggle("1")).not.toBeChecked();
    expect(toggle("1")).toBeEnabled();
});

it("старий список не замінює список після збереження налаштувань", async () => {
    const oldList = deferred();
    window.adsBot.getMyrahaMonsterPages.mockReturnValueOnce(oldList.promise);
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await waitFor(() => expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(1));
    window.adsBot.getMyrahaMonsterSettings.mockResolvedValue(ok({ hasApiKey: true, revision: 2 }));
    window.adsBot.getMyrahaMonsterPages.mockResolvedValue(ok({ items: [page("1", true)], revision: 2 }));
    await act(async () => { settingsChanged(); });
    expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    await act(async () => { oldList.resolve(ok({ items: [page("1")], revision: 1 })); });
    expect(toggle("1")).toBeChecked();
});

it("мережева помилка списку не означає відсутність доступу", async () => {
    window.adsBot.getMyrahaMonsterPages.mockResolvedValue({ ok: false, error: { message: "Сервіс недоступний" } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await screen.findAllByText("Сервіс недоступний");
    expect(toggle("1")).toBeDisabled();
    expect(screen.queryByText("Немає доступу до фанпейджі в MyrahaMonster")).not.toBeInTheDocument();
    window.adsBot.getMyrahaMonsterPages.mockResolvedValue(ok({ items: [page("1")], revision: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Перевірити приховування 1" }));
    await ready();
});

it("невідомий результат вимагає перевірки перед наступною mutation", async () => {
    window.adsBot.setMyrahaMonsterModeration.mockResolvedValue({ ok: false, error: { code: "MYRAHA_UNKNOWN", outcomeUnknown: true, message: "Стан невідомий" } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    await screen.findByText("Стан невідомий");
    expect(toggle("1")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Перевірити приховування 1" }));
    await ready();
    expect(window.adsBot.getMyrahaMonsterPage).toHaveBeenCalledWith("1");
    expect(toggle("1")).toBeChecked();
});

it.each([403, 404])("HTTP %s блокує лише недоступну фанку", async (httpStatus) => {
    window.adsBot.setMyrahaMonsterModeration.mockResolvedValue({ ok: false, error: { httpStatus, message: "Немає прав" } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    await screen.findByText("Немає прав");
    expect(toggle("1")).toBeDisabled();
    expect(toggle("2")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Перевірити приховування 1" })).not.toBeInTheDocument();
});

it("без API-ключа не виконує запити списку", async () => {
    window.adsBot.getMyrahaMonsterSettings.mockResolvedValue(ok({ hasApiKey: false, revision: 0 }));
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await screen.findAllByText("Додайте API-ключ у Налаштування → Інтеграції");
    expect(window.adsBot.getMyrahaMonsterPages).not.toHaveBeenCalled();
});

it("401 блокує перемикання всіх фанок; 429 не повторює mutation", async () => {
    window.adsBot.setMyrahaMonsterModeration.mockResolvedValue({ ok: false, error: { httpStatus: 429, message: "Ліміт 120 запитів" } });
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    await screen.findByText("Ліміт 120 запитів");
    expect(window.adsBot.setMyrahaMonsterModeration).toHaveBeenCalledTimes(1);
    expect(toggle("2")).toBeEnabled();
    window.adsBot.setMyrahaMonsterModeration.mockResolvedValue({ ok: false, error: { httpStatus: 401, message: "Недійсний ключ" } });
    fireEvent.click(toggle("2"));
    await screen.findAllByText("Недійсний ключ");
    expect(toggle("1")).toBeDisabled();
    expect(toggle("2")).toBeDisabled();
});

it("налаштування дозволяють замінити та видалити прихований ключ", async () => {
    render(<IntegrationsSettings />);
    const input = await screen.findByLabelText("API-ключ");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "test-only-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.adsBot.saveMyrahaMonsterSettings).toHaveBeenCalledWith({ baseUrl: "https://myrahamonster.xyz/api/v1", apiKey: "test-only-key", removeApiKey: false }));
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(screen.getByLabelText("Видалити збережений API-ключ"));
    fireEvent.click(screen.getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(window.adsBot.saveMyrahaMonsterSettings).toHaveBeenLastCalledWith({ baseUrl: "https://myrahamonster.xyz/api/v1", apiKey: "", removeApiKey: true }));
});

it("старий список не скасовує помилку ключа, отриману під час перемикання", async () => {
    const patch = deferred();
    const list = deferred();
    window.adsBot.setMyrahaMonsterModeration.mockReturnValue(patch.promise);
    render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    window.adsBot.getMyrahaMonsterPages.mockReturnValue(list.promise);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await waitFor(() => expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(2));
    await act(async () => { patch.resolve({ ok: false, error: { httpStatus: 401, message: "Недійсний ключ" } }); });
    await act(async () => { list.resolve(ok({ items: [page("1"), page("2")], revision: 1 })); });
    expect(toggle("2")).toBeDisabled();
    expect(screen.getAllByText("Недійсний ключ")).toHaveLength(3);
});


it("відкриття та повторне відкриття списку не запитує MyrahaMonster", async () => {
    const first = render(<Harness />);
    await act(async () => {});
    expect(window.adsBot.getMyrahaMonsterPages).not.toHaveBeenCalled();
    expect(toggle("1")).toBeDisabled();
    expect(screen.getAllByText("Оновіть список фанок, щоб перевірити стан")).toHaveLength(3);
    first.unmount();
    render(<Harness />);
    await act(async () => {});
    expect(window.adsBot.getMyrahaMonsterPages).not.toHaveBeenCalled();
});

it("стан фанки та незавершене перемикання зберігаються після зміни профілю", async () => {
    const patch = deferred();
    window.adsBot.setMyrahaMonsterModeration.mockReturnValue(patch.promise);
    const first = render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    first.unmount();
    const second = render(<Harness />);
    expect(toggle("1")).toBeDisabled();
    await act(async () => { patch.resolve(ok({ id: "1", enabled: true, revision: 1 })); });
    expect(toggle("1")).toBeChecked();
    expect(toggle("1")).toBeEnabled();
    second.unmount();
    render(<Harness />);
    await act(async () => {});
    expect(toggle("1")).toBeChecked();
    expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(1);
    expect(window.adsBot.setMyrahaMonsterModeration).toHaveBeenCalledTimes(1);
});

it("зміна ключа при закритій вкладці скидає кеш без запиту списку", async () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByText("Оновити інтеграцію"));
    await ready();
    fireEvent.click(toggle("1"));
    await waitFor(() => expect(toggle("1")).toBeChecked());
    first.unmount();
    window.adsBot.getMyrahaMonsterSettings.mockResolvedValue(ok({ hasApiKey: true, revision: 2 }));
    render(<Harness />);
    await waitFor(() => expect(toggle("1")).toBeDisabled());
    expect(toggle("1")).not.toBeChecked();
    expect(window.adsBot.getMyrahaMonsterPages).toHaveBeenCalledTimes(1);
});
