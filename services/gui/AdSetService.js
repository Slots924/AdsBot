const minute = 60_000;
const deleted = (row) => ["DELETED", "ARCHIVED"].includes(row.status) || ["DELETED", "ARCHIVED"].includes(row.effectiveStatus);
const due = (now, timestamp, interval) => !Number.isFinite(Date.parse(timestamp)) || now.getTime() - Date.parse(timestamp) >= interval;
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
            adSets: (snapshot?.adSets ?? []).map((row) => ({ ...row, ...byId[row.id], ...(deleted(row) ? { spend: null, leads: null, costPerLead: null, cpm: null, ctr: null } : {}) })),
            context, cacheHit: Boolean(snapshot?.listUpdatedAt), listUpdatedAt: snapshot?.listUpdatedAt ?? null,
            statisticsUpdatedAt: statistics?.updatedAt ?? null,
            statisticsStale: Boolean(statistics && statistics.context.rangeKey !== context.rangeKey),
            listError: snapshot?.listError ?? null,
            refreshError: snapshot?.listError ?? snapshot?.statisticsErrors?.[context.rangeKey] ?? null,
        };
    }

    #exclusive(input, operation, background = false) {
        const key = String(input.adAccountId);
        let queue = this.#pending.get(key);
        if (!queue) {
            queue = { foreground: [], background: [], running: false };
            this.#pending.set(key, queue);
        }
        return new Promise((resolve, reject) => {
            queue[background ? "background" : "foreground"].push({ operation, resolve, reject });
            if (!queue.running) {
                queue.running = true;
                setTimeout(() => this.#drain(key, queue), 0);
            }
        });
    }

    async #drain(key, queue) {
        // Статистика не випереджає списки інших кампаній, які вже очікують у черзі РК.
        while (queue.foreground.length || queue.background.length) {
            const task = queue.foreground.shift() ?? queue.background.shift();
            try { task.resolve(await task.operation()); } catch (error) { task.reject(error); }
        }
        this.#pending.delete(key);
    }

    refresh(input) {
        return this.#exclusive(input, () => this.#refreshList(input));
    }

    refreshStatistics(input) {
        return this.#exclusive(input, () => this.#refreshStatistics(input), true);
    }

    async #refreshList(input) {
        const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
        const save = () => this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, snapshot);
        if (due(this.now(), snapshot.listAttemptedAt ?? snapshot.listUpdatedAt, minute)) {
            snapshot.listAttemptedAt = this.now().toISOString();
            await save();
            try {
                const rows = await this.guiService.getCampaignAdSets(input.accountKey, input.campaignId);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь списку адсетів");
                const incoming = new Map(rows.map((row) => [String(row.id), row]));
                const previous = new Map((snapshot.adSets ?? []).map((row) => [String(row.id), row]));
                snapshot.adSets = [
                    ...rows.map((row) => ({ ...row, missingFromLatestRead: false, ...(previous.get(String(row.id))?.deletedLocally ? { status: "DELETED", effectiveStatus: "DELETED", deletedLocally: true } : {}) })),
                    ...(snapshot.adSets ?? []).filter((row) => !incoming.has(String(row.id))).map((row) => ({ ...row, missingFromLatestRead: true })),
                ];
                snapshot.listUpdatedAt = this.now().toISOString();
                snapshot.listError = null;
            } catch (error) { snapshot.listError = this.serializeError(error); }
            await save();
        }
        return this.read(input);
    }

    async #refreshStatistics(input) {
        const context = await this.#context(input);
        const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
        const save = () => this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, snapshot);
        const range = context.rangeKey;
        if (!snapshot.listError && snapshot.adSets?.some((row) => !row.missingFromLatestRead && !deleted(row))
            && due(this.now(), snapshot.statisticsAttempts?.[range] ?? snapshot.statistics?.[range]?.updatedAt, 15 * minute)) {
            snapshot.statisticsAttempts = { ...snapshot.statisticsAttempts, [range]: this.now().toISOString() };
            await save();
            try {
                const rows = await this.guiService.getCampaignAdSetInsights(input.accountKey, input.campaignId, input.datePreset ?? "today", context);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь статистики адсетів");
                const byId = Object.fromEntries(snapshot.adSets.filter((row) => !row.missingFromLatestRead && !deleted(row)).map((row) => [row.id, metrics()]));
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

    delete(input) {
        return this.#changeStatus({ ...input, status: "DELETED" });
    }

    setStatus(input) {
        if (!["ACTIVE", "PAUSED"].includes(input.status)) throw new Error("Статус адсету має бути ACTIVE або PAUSED");
        return this.#changeStatus(input);
    }

    #changeStatus(input) {
        return this.#exclusive(input, async () => {
            const before = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId);
            if (input.status !== "DELETED" && before?.adSets?.some((row) => String(row.id) === String(input.adSetId) && deleted(row))) throw new Error("Адсет уже видалено");
            const result = input.status === "DELETED"
                ? await this.guiService.deleteAdSet(input.accountKey, input)
                : await this.guiService.setAdSetStatus(input.accountKey, input);
            try {
                const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
                const rows = snapshot.adSets ?? [];
                const previous = rows.find((row) => String(row.id) === String(input.adSetId));
                const removed = { ...previous, ...result, id: String(input.adSetId), status: input.status, effectiveStatus: input.status, ...(input.status === "DELETED" ? { deletedLocally: true } : {}) };
                await this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, {
                    ...snapshot, adSets: previous ? rows.map((row) => String(row.id) === String(input.adSetId) ? removed : row) : [...rows, removed],
                });
                return { ...result, data: await this.read(input) };
            } catch {
                return { ...result, cacheError: { message: "Стан адсету змінено, але не вдалося оновити кеш. Перевірте Ads Manager." } };
            }
        });
    }

    async duplicate(input, context = {}) {
        const key = JSON.stringify([input.adAccountId, input.campaignId]);
        if (this.#duplicates.has(key)) throw new Error("Дублювання в цій кампанії вже виконується");
        this.#duplicates.add(key);
        try {
            return await this.#exclusive(input, async () => {
                const persist = async (copies) => {
                    const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
                    const rows = new Map((snapshot.adSets ?? []).map((row) => [String(row.id), row]));
                    for (const row of copies) rows.set(String(row.id), row);
                    await this.cache.setAdSetSnapshot(input.adAccountId, input.campaignId, { ...snapshot, adSets: [...rows.values()] });
                };
                const result = await this.guiService.duplicateAdSet(input.accountKey, input, {
                    ...context, onProgress: async (progress) => {
                        await persist(progress.copies);
                        await context.onProgress?.(progress);
                    },
                });
                const copies = result.copies ?? [];
                try {
                    if (copies.length) await persist(copies);
                } catch {
                    return { ...result, error: result.error ?? { message: "Копії створено, але не вдалося зберегти їх у кеші. Перевірте Ads Manager перед повтором.", code: "ADSET_CACHE_WRITE_FAILED" } };
                }
                return result;
            });
        } finally { this.#duplicates.delete(key); }
    }
}
