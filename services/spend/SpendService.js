function dateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}


function slotFor(date, timeZone) {
    let parts;
    try {
        parts = dateParts(date, timeZone || "Europe/Kyiv");
    } catch {
        parts = dateParts(date, "Europe/Kyiv");
    }
    const minute = String(Math.floor(Number(parts.minute) / 15) * 15).padStart(2, "0");
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    return { day, periodEnd: `${day} ${parts.hour}:${minute}:00` };
}


function subtractDays(day, count) {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - count);
    return date.toISOString().slice(0, 10);
}


function maxDate(left, right) {
    return String(left) > String(right) ? String(left) : String(right);
}


function spendToMicros(value) {
    const normalized = String(value ?? "0").trim().replace(",", ".");
    const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return 0;
    return Number(match[1]) * 1_000_000
        + Number((match[2] ?? "").padEnd(6, "0").slice(0, 6));
}


function microsToDecimal(value) {
    const micros = Math.round(Number(value) || 0);
    const whole = Math.trunc(micros / 1_000_000);
    const fraction = String(Math.abs(micros % 1_000_000)).padStart(6, "0")
        .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : String(whole);
}


function errorMessage(error) {
    return String(error?.message || "Невідома помилка");
}


export default class SpendService {
    constructor({
        store,
        guiService,
        facebookAccountManager,
        keitaroGuiService,
        logger = null,
        clock = () => new Date(),
    } = {}) {
        if (!store || !guiService || !facebookAccountManager) {
            throw new Error("Не передано залежності сервісу спенду");
        }
        this.store = store;
        this.guiService = guiService;
        this.facebookAccountManager = facebookAccountManager;
        this.keitaroGuiService = keitaroGuiService;
        this.logger = logger;
        this.clock = clock;
    }


    getOverview() {
        return this.store.getOverview();
    }


    getSettings() {
        return this.store.getSettings();
    }


    saveSettings(patch) {
        return this.store.saveSettings(patch);
    }


    async collect({ progress = async () => {}, signal } = {}) {
        const started = this.clock();
        const observedAt = new Date(
            Math.floor(started.getTime() / (15 * 60_000)) * 15 * 60_000
        ).toISOString();
        const settings = this.store.getSettings();
        const accounts = (await this.facebookAccountManager.list())
            .filter((account) => !account.archived && account.accountKey);
        const candidatesByAdAccount = new Map();
        const warnings = [];

        await progress({ stage: "discover", message: "Шукаємо рекламні акаунти API-клієнтів…" });
        for (const [index, apiAccount] of accounts.entries()) {
            if (signal?.aborted) throw Object.assign(new Error("Збір спенду зупинено"), { code: "ABORT_ERR" });
            try {
                const adAccounts = await this.guiService.getAdAccounts(apiAccount.accountKey);
                for (const adAccount of adAccounts) {
                    const id = String(adAccount.id ?? "").trim();
                    if (!id) continue;
                    const candidates = candidatesByAdAccount.get(id) ?? [];
                    candidates.push({ accountKey: apiAccount.accountKey, adAccount });
                    candidatesByAdAccount.set(id, candidates);
                }
            } catch (error) {
                warnings.push({ accountKey: apiAccount.accountKey, error: errorMessage(error) });
            }
            await progress({
                stage: "discover",
                current: index + 1,
                total: accounts.length,
                message: `Перевірено API-клієнтів: ${index + 1}/${accounts.length}`,
            });
        }

        let collectedAccounts = 0;
        let collectedCampaignRows = 0;
        const adAccounts = [...candidatesByAdAccount.entries()];
        for (const [index, [adAccountId, candidates]] of adAccounts.entries()) {
            if (signal?.aborted) throw Object.assign(new Error("Збір спенду зупинено"), { code: "ABORT_ERR" });
            let success = false;
            let lastError = null;
            for (const candidate of candidates) {
                const timezoneName = candidate.adAccount.timezoneName || "Europe/Kyiv";
                const current = slotFor(started, timezoneName);
                const stored = this.store.getAdAccount(adAccountId);
                const recentStart = subtractDays(current.day, settings.reconciliationDays - 1);
                const since = stored?.lastCollectedAt
                    ? maxDate(settings.startDate, recentStart)
                    : settings.startDate;
                try {
                    const rows = await this.guiService.getAdCampaignSpend(
                        candidate.accountKey,
                        adAccountId,
                        { since, until: current.day }
                    );
                    const normalizedRows = rows.map((row) => ({
                        ...row,
                        spendMicros: spendToMicros(row.spend),
                    }));
                    this.store.recordSnapshots({
                        account: candidate.adAccount,
                        accountKey: candidate.accountKey,
                        rows: normalizedRows,
                        observedAt,
                        currentDate: current.day,
                        currentPeriodEnd: current.periodEnd,
                    });
                    collectedAccounts += 1;
                    collectedCampaignRows += normalizedRows.length;
                    success = true;
                    break;
                } catch (error) {
                    lastError = error;
                    this.logger?.warn("spend.collect.account-failed", "Не вдалося отримати спенд рекламного акаунта", {
                        adAccountId,
                        accountKey: candidate.accountKey,
                        error,
                    });
                }
            }
            if (!success) {
                const candidate = candidates[0];
                this.store.recordAdAccount(
                    candidate.adAccount,
                    candidate.accountKey,
                    observedAt,
                    errorMessage(lastError)
                );
                warnings.push({ adAccountId, error: errorMessage(lastError) });
            }
            await progress({
                stage: "collect",
                current: index + 1,
                total: adAccounts.length,
                message: `Зібрано рекламних акаунтів: ${index + 1}/${adAccounts.length}`,
            });
        }
        this.store.markRun("collect", started.toISOString());
        return {
            status: warnings.length ? "success_with_warnings" : "success",
            apiClients: accounts.length,
            uniqueAdAccounts: adAccounts.length,
            collectedAccounts,
            campaignRows: collectedCampaignRows,
            warnings,
        };
    }


    async exportToKeitaro({ progress = async () => {}, signal } = {}) {
        if (!this.keitaroGuiService) {
            throw Object.assign(new Error("Сервіс Keitaro не підключено"), { code: "KEITARO_UNAVAILABLE" });
        }
        const started = this.clock();
        const settings = this.store.getSettings();
        const today = slotFor(started, "Europe/Kyiv").day;
        await progress({ stage: "mapping", message: "Зіставляємо Meta ID з кампаніями Keitaro…" });
        const mappings = await this.keitaroGuiService.getSpendMappings({
            from: settings.startDate,
            to: today,
            groupIds: settings.keitaroGroupIds,
        });
        this.store.replaceMappings(mappings, started.toISOString());
        const blocked = this.store.getOverview().campaigns.filter((campaign) => (
            campaign.pending !== 0
            && ["mapping-missing", "mapping-ambiguous"].includes(campaign.status)
        ));
        const pending = this.store.getPendingExports();
        const warnings = blocked.map((campaign) => ({
            metaCampaignId: campaign.campaignId,
            error: campaign.status === "mapping-ambiguous"
                ? "Meta ID знайдено у кількох кампаніях Keitaro"
                : "Meta ID не знайдено в sub_id_2 Keitaro",
        }));
        let sent = 0;
        for (const [index, item] of pending.entries()) {
            if (signal?.aborted) throw Object.assign(new Error("Передачу спенду зупинено"), { code: "ABORT_ERR" });
            try {
                await this.keitaroGuiService.updateSpendCosts(item.keitaroCampaignId, {
                    start_date: `${item.spendDate} 00:00:00`,
                    end_date: item.periodEnd,
                    cost: microsToDecimal(item.costMicros),
                    currency: item.currency || "USD",
                    timezone: item.timezoneName || "Europe/Kyiv",
                    filters: { sub_id_2: item.metaCampaignId },
                });
                this.store.recordExportAttempt(item, {
                    ok: true,
                    sentAt: this.clock().toISOString(),
                });
                sent += 1;
            } catch (error) {
                this.store.recordExportAttempt(item, {
                    ok: false,
                    error: errorMessage(error),
                    sentAt: this.clock().toISOString(),
                });
                warnings.push({
                    metaCampaignId: item.metaCampaignId,
                    keitaroCampaignId: item.keitaroCampaignId,
                    spendDate: item.spendDate,
                    error: errorMessage(error),
                });
            }
            await progress({
                stage: "export",
                current: index + 1,
                total: pending.length,
                message: `Передано періодів у Keitaro: ${index + 1}/${pending.length}`,
            });
        }
        this.store.markRun("export", started.toISOString());
        return {
            status: warnings.length ? "success_with_warnings" : "success",
            mappings: mappings.length,
            pending: pending.length,
            sent,
            warnings,
        };
    }
}


export { microsToDecimal, slotFor, spendToMicros };
