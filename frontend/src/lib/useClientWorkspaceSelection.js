import { useCallback, useState } from "react";

export default function useClientWorkspaceSelection(accountKey) {
    const [clientWorkspaceSelections, setClientWorkspaceSelections] = useState({});
    const selection = clientWorkspaceSelections[accountKey];

    const updateSelection = useCallback((field, value) => {
        if (!accountKey) return;
        setClientWorkspaceSelections((current) => {
            const previous = current[accountKey] || {};
            const next = typeof value === "function" ? value(previous[field] || "") : value;
            if ((previous[field] || "") === next) return current;
            return { ...current, [accountKey]: { ...previous, [field]: next } };
        });
    }, [accountKey]);

    const setSelectedAdAccountId = useCallback((value) => {
        updateSelection("selectedAdAccountId", value);
    }, [updateSelection]);
    const setSelectedPageId = useCallback((value) => {
        updateSelection("selectedPageId", value);
    }, [updateSelection]);

    const reconcileWorkspaceSelection = useCallback((key, workspace) => {
        setClientWorkspaceSelections((current) => {
            const previous = current[key];
            if (!previous) return current;
            const selectedAdAccountId = workspace.adAccounts.some((item) => String(item.id) === String(previous.selectedAdAccountId))
                ? previous.selectedAdAccountId : "";
            const selectedPageId = workspace.pages.some((item) => String(item.id) === String(previous.selectedPageId))
                ? previous.selectedPageId : "";
            if (selectedAdAccountId === previous.selectedAdAccountId && selectedPageId === previous.selectedPageId) return current;
            return { ...current, [key]: { selectedAdAccountId, selectedPageId } };
        });
    }, []);

    return {
        clientWorkspaceSelections, setClientWorkspaceSelections,
        selectedAdAccountId: selection?.selectedAdAccountId || "", setSelectedAdAccountId,
        selectedPageId: selection?.selectedPageId || "", setSelectedPageId,
        reconcileWorkspaceSelection,
    };
}
