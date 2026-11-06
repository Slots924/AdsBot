const minute = 60_000;
const deleted = (row) => ["DELETED", "ARCHIVED"].includes(row.status) || ["DELETED", "ARCHIVED"].includes(row.effectiveStatus);
const due = (now, timestamp, interval) => !Number.isFinite(Date.parse(timestamp)) || now.getTime() - Date.parse(timestamp) >= interval;
const savedStatus = (row) => ({ status: row.status, effectiveStatus: row.effectiveStatus, statusRevision: row.statusRevision ?? 0, ...(row.deletedLocally ? { deletedLocally: true } : {}) });
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
    #statusRequests = new Set();

    constructor({ cache, guiService, serializeError, now = () => new Date() }) {
        Object.assign(this, { cache, guiService, serializeError, now });
    }

    #context(input) {
        return this.cache.getCampaignContext(input.adAccountId, input.datePreset ?? "today");
    }

    #update(input, updater) {
        return this.cache.updateAdSetSnapshot(input.adAccountId, input.campaignId, updater);
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

    async enrichCampaigns(input, campaigns) {
        return Promise.all(campaigns.map(async (campaign) => ({ ...campaign,
            ...this.#rejectedCount(await this.cache.getAdSetSnapshot(input.adAccountId, campaign.id)),
        })));
    }

    #rejectedCount(snapshot) {
        return { rejectedCount: snapshot?.rejectedCount ?? null,
            rejectedCountUpdatedAt: snapshot?.rejectedCountUpdatedAt ?? null,
            rejectedCountAttemptedAt: snapshot?.rejectedCountAttemptedAt ?? null,
            rejectedCountError: snapshot?.rejectedCountError ?? null };
    }

    refreshRejectedCount(input) {
        return this.#exclusive(input, async () => {
            const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
            if (!due(this.now(), snapshot.rejectedCountAttemptedAt ?? snapshot.rejectedCountUpdatedAt, minute)) {
                return { ...this.#rejectedCount(snapshot), skipped: true };
            }
            await this.#update(input, (current) => ({ ...current, rejectedCountAttemptedAt: this.now().toISOString() }));
            try {
                const count = await this.guiService.getRejectedAdSetCount(input.accountKey, input.adAccountId, input.campaignId);
                if (!Number.isSafeInteger(count) || count < 0) throw new Error("Некоректна кількість відхилених адсетів");
                await this.#update(input, (current) => ({ ...current, rejectedCount: count,
                    rejectedCountUpdatedAt: this.now().toISOString(), rejectedCountError: null }));
            } catch (error) {
                await this.#update(input, (current) => ({ ...current, rejectedCountError: this.serializeError(error) }));
            }
            return { ...this.#rejectedCount(await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId)), skipped: false };
        });
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
        return this.#exclusive(input, async () => {
            if (input.manual) {
                const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId);
                if (!due(this.now(), snapshot?.manualAttemptedAt, minute)) return { ...await this.read(input), manualRefreshAllowed: false };
                await this.#update(input, (current) => ({ ...current, manualAttemptedAt: this.now().toISOString() }));
            }
            return { ...await this.#refreshList(input), manualRefreshAllowed: Boolean(input.manual) };
        });
    }

    refreshStatistics(input) {
        return this.#exclusive(input, () => this.#refreshStatistics(input), true);
    }

    async #refreshList(input) {
        const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
        if (due(this.now(), snapshot.listAttemptedAt ?? snapshot.listUpdatedAt, minute)) {
            await this.#update(input, (current) => ({ ...current, listAttemptedAt: this.now().toISOString() }));
            try {
                const rows = await this.guiService.getCampaignAdSets(input.accountKey, input.campaignId);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь списку адсетів");
                const incoming = new Map(rows.map((row) => [String(row.id), row]));
                const requested = new Map((snapshot.adSets ?? []).map((row) => [String(row.id), row]));
                await this.#update(input, (current) => {
                    const previous = new Map((current.adSets ?? []).map((row) => [String(row.id), row]));
                    return { ...current, listUpdatedAt: this.now().toISOString(), listError: null, adSets: [
                        ...rows.map((row) => {
                            const old = previous.get(String(row.id));
                            // Пізня відповідь списку не відкочує статус, змінений після початку читання.
                            const changed = old && (old.deletedLocally || (old.statusRevision ?? 0) !== (requested.get(String(row.id))?.statusRevision ?? 0));
                            return { ...row, statusRevision: old?.statusRevision ?? 0, missingFromLatestRead: false, ...(changed ? savedStatus(old) : {}) };
                        }),
                        ...(current.adSets ?? []).filter((row) => !incoming.has(String(row.id))).map((row) => ({ ...row, missingFromLatestRead: true })),
                    ] };
                });
            } catch (error) {
                await this.#update(input, (current) => ({ ...current, listError: this.serializeError(error) }));
            }
        }
        return this.read(input);
    }

    async #refreshStatistics(input) {
        const context = await this.#context(input);
        const snapshot = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId) ?? {};
        const range = context.rangeKey;
        const lastAttempt = snapshot.statisticsAttemptedAt ?? Object.values(snapshot.statisticsAttempts ?? {}).sort().at(-1) ?? snapshot.lastStatistics?.updatedAt;
        if (!snapshot.listError && snapshot.adSets?.some((row) => !row.missingFromLatestRead && !deleted(row))
            && due(this.now(), lastAttempt, 15 * minute)) {
            await this.#update(input, (current) => ({ ...current, statisticsAttemptedAt: this.now().toISOString(), statisticsAttempts: { ...current.statisticsAttempts, [range]: this.now().toISOString() } }));
            try {
                const rows = await this.guiService.getCampaignAdSetInsights(input.accountKey, input.campaignId, input.datePreset ?? "today", context);
                if (!Array.isArray(rows)) throw new Error("Некоректна відповідь статистики адсетів");
                const byId = Object.fromEntries(snapshot.adSets.filter((row) => !row.missingFromLatestRead && !deleted(row)).map((row) => [row.id, metrics()]));
                for (const row of rows) byId[row.adset_id] = metrics(row);
                const statistics = { context, updatedAt: this.now().toISOString(), byId };
                await this.#update(input, (current) => ({ ...current,
                    statistics: { ...current.statistics, [range]: statistics }, lastStatistics: statistics,
                    statisticsErrors: { ...current.statisticsErrors, [range]: null },
                }));
            } catch (error) {
                await this.#update(input, (current) => ({ ...current, statisticsErrors: { ...current.statisticsErrors, [range]: this.serializeError(error) } }));
            }
        }
        return this.read(input);
    }

    delete(input) {
        return this.#withStatusLock(input, () => this.#exclusive(input, () => this.#changeStatus({ ...input, status: "DELETED" })));
    }

    setStatus(input) {
        if (!["ACTIVE", "PAUSED"].includes(input.status)) throw new Error("Статус адсету має бути ACTIVE або PAUSED");
        return this.#withStatusLock(input, () => this.#changeStatus(input));
    }

    async #withStatusLock(input, operation) {
        const key = JSON.stringify([String(input.adAccountId), String(input.adSetId)]);
        if (this.#statusRequests.has(key)) throw Object.assign(new Error("Стан цього адсету вже змінюється"), { code: "ADSET_STATUS_PENDING" });
        this.#statusRequests.add(key);
        try { return await operation(); } finally { this.#statusRequests.delete(key); }
    }

    async #changeStatus(input) {
        const before = await this.cache.getAdSetSnapshot(input.adAccountId, input.campaignId);
        if (input.status !== "DELETED" && before?.adSets?.some((row) => String(row.id) === String(input.adSetId) && deleted(row))) throw new Error("Адсет уже видалено");
        const result = input.status === "DELETED"
            ? await this.guiService.deleteAdSet(input.accountKey, input)
            : await this.guiService.setAdSetStatus(input.accountKey, input);
        try {
            await this.#update(input, (current) => {
                const rows = current.adSets ?? [];
                const previous = rows.find((row) => String(row.id) === String(input.adSetId));
                const changed = { ...previous, ...result, id: String(input.adSetId), status: input.status, effectiveStatus: input.status, statusRevision: (previous?.statusRevision ?? 0) + 1, ...(input.status === "DELETED" ? { deletedLocally: true } : {}) };
                return { ...current, adSets: previous ? rows.map((row) => String(row.id) === String(input.adSetId) ? changed : row) : [...rows, changed] };
            });
            return { ...result, data: await this.read(input) };
        } catch {
            return { ...result, cacheError: { message: "Стан адсету змінено, але не вдалося оновити кеш. Перевірте Ads Manager." } };
        }
    }

    async duplicate(input, context = {}) {
        const key = JSON.stringify([input.adAccountId, input.campaignId]);
        if (this.#duplicates.has(key)) throw new Error("Дублювання в цій кампанії вже виконується");
        this.#duplicates.add(key);
        try {
            return await this.#exclusive(input, async () => {
                const persist = async (copies) => {
                    await this.#update(input, (current) => {
                        const rows = new Map((current.adSets ?? []).map((row) => [String(row.id), row]));
                        for (const row of copies) {
                            const previous = rows.get(String(row.id));
                            rows.set(String(row.id), { ...previous, ...row, ...(previous?.statusRevision || previous?.deletedLocally ? savedStatus(previous) : {}) });
                        }
                        return { ...current, adSets: [...rows.values()] };
                    });
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
