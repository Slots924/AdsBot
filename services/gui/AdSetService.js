const minute = 60_000;
const metrics = (row = {}) => {
    const spend = Number(row.spend ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const leads = Number(row.actions?.find((action) => action.action_type === "lead")?.value ?? 0);
    return { spend, impressions, clicks, leads, costPerLead: leads ? spend / leads : null,
        cpm: impressions ? spend / impressions * 1000 : null, ctr: impressions ? clicks / impressions * 100 : null };
};

export default class AdSetService {
    #pending = new Map();
    #duplicates = new Set();

    constructor({ cache, guiService, serializeError, now = () => new Date() }) {
        Object.assign(this, { cache, guiService, serializeError, now });
    }

    #context(input) {
        return this.cache.getCampaignContext(input.adAccountId, input.datePreset ?? "today");
    }

    async read(input) {
        const context = await this.#context(input);
        const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId);
        const statistics = snapshot?.statistics?.[context.rangeKey] ?? snapshot?.lastStatistics;
        const byId = statistics?.byId ?? {};
        return {
            adSets: (snapshot?.adSets ?? []).map((row) => ({ ...row, ...byId[row.id] })),
            context, cacheHit: Boolean(snapshot?.listUpdatedAt), listUpdatedAt: snapshot?.listUpdatedAt ?? null,
            statisticsUpdatedAt: statistics?.updatedAt ?? null,
            statisticsStale: Boolean(statistics && statistics.context.rangeKey !== context.rangeKey),
            refreshError: snapshot?.listError ?? snapshot?.statisticsErrors?.[context.rangeKey] ?? null,
        };
    }

    async #exclusive(input, operation) {
        const key = String(input.adAccountId);
        // У межах РК запити йдуть послідовно, без сплесків при розгортанні кількох кампаній.
        const previous = this.#pending.get(key) ?? Promise.resolve();
        const pending = previous.catch(() => {}).then(operation);
        this.#pending.set(key, pending);
        try { return await pending; } finally { if (this.#pending.get(key) === pending) this.#pending.delete(key); }
    }

    refresh(input) {
        return this.#exclusive(input, () => this.#refresh(input));
    }

    async #refresh(input) {
        const context = await this.#context(input);
        let snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
        const due = (timestamp, interval) => !Number.isFinite(Date.parse(timestamp)) || this.now().getTime() - Date.parse(timestamp) >= interval;
        const save = () => this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, snapshot);
        if (due(snapshot.listAttemptedAt ?? snapshot.listUpdatedAt, minute)) {
            snapshot.listAttemptedAt = this.now().toISOString();
            await save();
            try {
                const rows = await this.guiService.getCampaignAdSets(input.accountKey, input.campaignId);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь списку адсетів");
                const incoming = new Map(rows.map((row) => [String(row.id), row]));
                snapshot.adSets = [
                    ...rows.map((row) => ({ ...row, missingFromLatestRead: false })),
                    ...(snapshot.adSets ?? []).filter((row) => !incoming.has(String(row.id))).map((row) => ({ ...row, missingFromLatestRead: true })),
                ];
                snapshot.listUpdatedAt = this.now().toISOString();
                snapshot.listError = null;
            } catch (error) { snapshot.listError = this.serializeError(error); }
            await save();
        }
        const range = context.rangeKey;
        if (!snapshot.listError && snapshot.adSets?.some((row) => !row.missingFromLatestRead)
            && due(snapshot.statisticsAttempts?.[range] ?? snapshot.statistics?.[range]?.updatedAt, 15 * minute)) {
            snapshot.statisticsAttempts = { ...snapshot.statisticsAttempts, [range]: this.now().toISOString() };
            await save();
            try {
                const rows = await this.guiService.getCampaignAdSetInsights(input.accountKey, input.campaignId, input.datePreset ?? "today", context);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь статистики адсетів");
                const byId = Object.fromEntries(snapshot.adSets.filter((row) => !row.missingFromLatestRead).map((row) => [row.id, metrics()]));
                for (const row of rows) byId[row.adset_id] = metrics(row);
                const statistics = { context, updatedAt: this.now().toISOString(), byId };
                snapshot.statistics = { ...snapshot.statistics, [range]: statistics };
                snapshot.lastStatistics = statistics;
                snapshot.statisticsErrors = { ...snapshot.statisticsErrors, [range]: null };
            } catch (error) {
                snapshot.statisticsErrors = { ...snapshot.statisticsErrors, [range]: this.serializeError(error) };
            }
            await save();
        }
        return this.read(input);
    }

    async duplicate(input) {
        const key = JSON.stringify([input.adAccountId, input.campaignId]);
        if (this.#duplicates.has(key)) throw new Error("Дублювання в цій кампанії вже виконується");
        this.#duplicates.add(key);
        try {
            return await this.#exclusive(input, async () => {
                const result = await this.guiService.duplicateAdSet(input.accountKey, input);
                const copies = result.copies ?? [];
                try {
                    const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
                    if (copies.length) await this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, {
                        ...snapshot, adSets: [...(snapshot.adSets ?? []), ...copies],
                    });
                } catch {
                    return { ...result, error: result.error ?? { message: "Копії створено, але не вдалося зберегти їх у кеші. Перевірте Ads Manager перед повтором.", code: "ADSET_CACHE_WRITE_FAILED" } };
                }
                return result;
            });
        } finally { this.#duplicates.delete(key); }
    }
}
