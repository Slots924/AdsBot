import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import useClientWorkspaceSelection from "../lib/useClientWorkspaceSelection.js";
import { normalizeState } from "../../../services/gui/AppStateStore.js";

describe("Вибір РК та фанпейджа для кожного API-клієнта", () => {
    it("повертає окремий вибір після перемикання клієнтів, зокрема зі спільним РК", () => {
        const { result, rerender } = renderHook(({ key }) => useClientWorkspaceSelection(key), { initialProps: { key: "a" } });
        act(() => { result.current.setSelectedAdAccountId("shared"); result.current.setSelectedPageId("page-a"); });
        rerender({ key: "b" });
        expect(result.current.selectedAdAccountId).toBe("");
        expect(result.current.selectedPageId).toBe("");
        act(() => { result.current.setSelectedAdAccountId("shared"); result.current.setSelectedPageId("page-b"); });
        rerender({ key: "a" });
        expect(result.current.selectedAdAccountId).toBe("shared");
        expect(result.current.selectedPageId).toBe("page-a");
        rerender({ key: "b" });
        expect(result.current.selectedPageId).toBe("page-b");
    });

    it("пізня відповідь та відкладений setter змінюють лише свого клієнта", () => {
        const { result, rerender } = renderHook(({ key }) => useClientWorkspaceSelection(key), { initialProps: { key: "a" } });
        act(() => { result.current.setSelectedAdAccountId("act-a"); result.current.setSelectedPageId("page-a"); });
        const setPageForA = result.current.setSelectedPageId;
        rerender({ key: "b" });
        act(() => { result.current.setSelectedAdAccountId("act-b"); result.current.setSelectedPageId("page-b"); });
        act(() => {
            setPageForA((current) => `${current}-updated`);
            result.current.reconcileWorkspaceSelection("a", { adAccounts: [], pages: [{ id: "page-a-updated" }] });
        });
        expect(result.current.selectedAdAccountId).toBe("act-b");
        expect(result.current.selectedPageId).toBe("page-b");
        rerender({ key: "a" });
        expect(result.current.selectedAdAccountId).toBe("");
        expect(result.current.selectedPageId).toBe("page-a-updated");
    });

    it("відновлює старий стан і зберігає вибір усіх клієнтів після повторного відкриття", () => {
        const legacy = normalizeState({ selectedAccountKey: "a", selectedPageId: "page-a", selectedAdAccountId: "act-a" });
        const { result, rerender, unmount } = renderHook(({ key }) => useClientWorkspaceSelection(key), { initialProps: { key: "a" } });
        act(() => result.current.setClientWorkspaceSelections(legacy.clientWorkspaceSelections));
        expect(result.current.selectedPageId).toBe("page-a");
        rerender({ key: "b" });
        act(() => { result.current.setSelectedAdAccountId("act-b"); result.current.setSelectedPageId("page-b"); });
        const saved = normalizeState(JSON.parse(JSON.stringify({ selectedAccountKey: "b", clientWorkspaceSelections: result.current.clientWorkspaceSelections })));
        unmount();
        const restored = renderHook(({ key }) => useClientWorkspaceSelection(key), { initialProps: { key: "a" } });
        act(() => restored.result.current.setClientWorkspaceSelections(saved.clientWorkspaceSelections));
        expect(restored.result.current.selectedAdAccountId).toBe("act-a");
        expect(restored.result.current.selectedPageId).toBe("page-a");
        restored.rerender({ key: "b" });
        expect(restored.result.current.selectedAdAccountId).toBe("act-b");
        expect(restored.result.current.selectedPageId).toBe("page-b");
    });

    it("відкидає некоректні записи та зайві поля збереженого стану", () => {
        const state = normalizeState({ clientWorkspaceSelections: {
            a: { selectedAdAccountId: "act-a", selectedPageId: "page-a", unrelated: "discard" },
            b: null, c: [], d: { selectedPageId: 123 },
        } });
        expect(state.clientWorkspaceSelections).toEqual({
            a: { selectedAdAccountId: "act-a", selectedPageId: "page-a" },
            d: { selectedAdAccountId: "", selectedPageId: "" },
        });
    });
});
