// Перевіряє актуальні джерела після будь-якого результату додавання карти.
export async function addCardAndRefreshSources({ addCard, refreshSources }) {
    try {
        return await addCard();
    } finally {
        try { await refreshSources(); } catch { /* Помилка перевірки відображається окремо від результату додавання. */ }
    }
}
