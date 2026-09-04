import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";


const defaultSpendSettings = Object.freeze({
    startDate: "2026-09-01",
    commissionPercent: 10,
    collectEnabled: false,
    collectIntervalMinutes: 60,
    exportEnabled: false,
    exportIntervalMinutes: 60,
    reconciliationDays: 5,
    keitaroGroupIds: [],
});


function normalizeDate(value, fallback = defaultSpendSettings.startDate) {
    const text = String(value ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}


function normalizeMinutes(value, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(1440, Math.max(15, number)) : fallback;
}


function normalizeCommissionPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return defaultSpendSettings.commissionPercent;
    return Math.min(100, Math.max(0, Math.round(number * 100) / 100));
}


function commissionBasisPoints(value) {
    return Math.round(normalizeCommissionPercent(value) * 100);
}


function addCommission(spendMicros, basisPoints) {
    return Math.round(Number(spendMicros || 0) * (10_000 + Number(basisPoints || 0)) / 10_000);
}


function normalizeSettings(value = {}) {
    return {
        startDate: normalizeDate(value.startDate),
        commissionPercent: normalizeCommissionPercent(value.commissionPercent),
        collectEnabled: value.collectEnabled === true,
        collectIntervalMinutes: normalizeMinutes(
            value.collectIntervalMinutes,
            defaultSpendSettings.collectIntervalMinutes
        ),
        exportEnabled: value.exportEnabled === true,
        exportIntervalMinutes: normalizeMinutes(
            value.exportIntervalMinutes,
            defaultSpendSettings.exportIntervalMinutes
        ),
        reconciliationDays: Math.min(30, Math.max(
            1,
            Math.round(Number(value.reconciliationDays)) || defaultSpendSettings.reconciliationDays
        )),
        keitaroGroupIds: [...new Set(
            (Array.isArray(value.keitaroGroupIds) ? value.keitaroGroupIds : [])
                .map((id) => String(id ?? "").trim())
                .filter(Boolean)
        )],
    };
}


function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}


function fromMicros(value) {
    return Number(value ?? 0) / 1_000_000;
}


export default class SpendStore {
    constructor({ databaseFile = "./data/spend/spend.sqlite" } = {}) {
        this.databaseFile = databaseFile;
        this.db = null;
    }


    async initialize() {
        if (this.db) return this;
        await mkdir(path.dirname(this.databaseFile), { recursive: true });
        this.db = new DatabaseSync(this.databaseFile);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS spend_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                start_date TEXT NOT NULL,
                commission_basis_points INTEGER NOT NULL DEFAULT 1000,
                collect_enabled INTEGER NOT NULL DEFAULT 0,
                collect_interval_minutes INTEGER NOT NULL DEFAULT 60,
                export_enabled INTEGER NOT NULL DEFAULT 0,
                export_interval_minutes INTEGER NOT NULL DEFAULT 60,
                reconciliation_days INTEGER NOT NULL DEFAULT 5,
                keitaro_group_ids TEXT NOT NULL DEFAULT '[]',
                last_collection_run_at TEXT,
                last_export_run_at TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta_ad_accounts (
                ad_account_id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT '',
                timezone_name TEXT NOT NULL DEFAULT 'Europe/Kyiv',
                source_account_key TEXT NOT NULL DEFAULT '',
                last_collected_at TEXT,
                last_error TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta_campaigns (
                campaign_id TEXT PRIMARY KEY,
                ad_account_id TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT '',
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                FOREIGN KEY (ad_account_id) REFERENCES meta_ad_accounts(ad_account_id)
            );
            CREATE TABLE IF NOT EXISTS spend_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id TEXT NOT NULL,
                spend_date TEXT NOT NULL,
                period_end TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                spend_micros INTEGER NOT NULL,
                delta_micros INTEGER NOT NULL,
                UNIQUE (campaign_id, spend_date, observed_at),
                FOREIGN KEY (campaign_id) REFERENCES meta_campaigns(campaign_id)
            );
            CREATE INDEX IF NOT EXISTS spend_snapshots_latest
                ON spend_snapshots(campaign_id, spend_date, observed_at DESC);
            CREATE TABLE IF NOT EXISTS keitaro_campaign_mapping (
                meta_campaign_id TEXT NOT NULL,
                keitaro_campaign_id TEXT NOT NULL,
                seen_at TEXT NOT NULL,
                PRIMARY KEY (meta_campaign_id, keitaro_campaign_id)
            );
            CREATE TABLE IF NOT EXISTS keitaro_cost_exports (
                meta_campaign_id TEXT NOT NULL,
                keitaro_campaign_id TEXT NOT NULL,
                spend_date TEXT NOT NULL,
                spend_micros INTEGER NOT NULL,
                exported_cost_micros INTEGER NOT NULL DEFAULT 0,
                commission_basis_points INTEGER NOT NULL DEFAULT 0,
                source_observed_at TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                sent_at TEXT,
                error TEXT,
                PRIMARY KEY (meta_campaign_id, keitaro_campaign_id, spend_date)
            );
        `);
        const settingsColumns = new Set(
            this.db.prepare("PRAGMA table_info(spend_settings)").all().map((column) => column.name)
        );
        if (!settingsColumns.has("commission_basis_points")) {
            this.db.exec("ALTER TABLE spend_settings ADD COLUMN commission_basis_points INTEGER NOT NULL DEFAULT 1000");
        }
        const exportColumns = new Set(
            this.db.prepare("PRAGMA table_info(keitaro_cost_exports)").all().map((column) => column.name)
        );
        if (!exportColumns.has("exported_cost_micros")) {
            this.db.exec("ALTER TABLE keitaro_cost_exports ADD COLUMN exported_cost_micros INTEGER NOT NULL DEFAULT 0");
            this.db.exec("UPDATE keitaro_cost_exports SET exported_cost_micros = spend_micros");
        }
        if (!exportColumns.has("commission_basis_points")) {
            this.db.exec("ALTER TABLE keitaro_cost_exports ADD COLUMN commission_basis_points INTEGER NOT NULL DEFAULT 0");
        }
        const settings = defaultSpendSettings;
        this.db.prepare(`
            INSERT OR IGNORE INTO spend_settings (
                id, start_date, collect_enabled, collect_interval_minutes,
                export_enabled, export_interval_minutes, reconciliation_days,
                keitaro_group_ids, updated_at
            ) VALUES (1, ?, 0, ?, 0, ?, ?, '[]', ?)
        `).run(
            settings.startDate,
            settings.collectIntervalMinutes,
            settings.exportIntervalMinutes,
            settings.reconciliationDays,
            new Date().toISOString()
        );
        return this;
    }


    getSettings() {
        const row = this.db.prepare("SELECT * FROM spend_settings WHERE id = 1").get();
        return {
            startDate: row.start_date,
            commissionPercent: Number(row.commission_basis_points || 0) / 100,
            collectEnabled: Boolean(row.collect_enabled),
            collectIntervalMinutes: row.collect_interval_minutes,
            exportEnabled: Boolean(row.export_enabled),
            exportIntervalMinutes: row.export_interval_minutes,
            reconciliationDays: row.reconciliation_days,
            keitaroGroupIds: parseJsonArray(row.keitaro_group_ids),
            lastCollectionRunAt: row.last_collection_run_at ?? null,
            lastExportRunAt: row.last_export_run_at ?? null,
        };
    }


    saveSettings(patch = {}) {
        const current = this.getSettings();
        const next = normalizeSettings({ ...current, ...patch });
        this.db.prepare(`
            UPDATE spend_settings SET
                start_date = ?, commission_basis_points = ?, collect_enabled = ?, collect_interval_minutes = ?,
                export_enabled = ?, export_interval_minutes = ?, reconciliation_days = ?,
                keitaro_group_ids = ?, updated_at = ?
            WHERE id = 1
        `).run(
            next.startDate,
            commissionBasisPoints(next.commissionPercent),
            Number(next.collectEnabled),
            next.collectIntervalMinutes,
            Number(next.exportEnabled),
            next.exportIntervalMinutes,
            next.reconciliationDays,
            JSON.stringify(next.keitaroGroupIds),
            new Date().toISOString()
        );
        return this.getSettings();
    }


    recordAdAccount(account, accountKey, collectedAt, error = null) {
        this.db.prepare(`
            INSERT INTO meta_ad_accounts (
                ad_account_id, name, currency, timezone_name, source_account_key,
                last_collected_at, last_error, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ad_account_id) DO UPDATE SET
                name = excluded.name,
                currency = excluded.currency,
                timezone_name = excluded.timezone_name,
                source_account_key = excluded.source_account_key,
                last_collected_at = CASE WHEN excluded.last_error IS NULL
                    THEN excluded.last_collected_at ELSE meta_ad_accounts.last_collected_at END,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
        `).run(
            String(account.id),
            String(account.name ?? ""),
            String(account.currency ?? ""),
            String(account.timezoneName ?? "Europe/Kyiv"),
            String(accountKey ?? ""),
            collectedAt,
            error ? String(error) : null,
            new Date().toISOString()
        );
    }


    getAdAccount(adAccountId) {
        return this.db.prepare(`
            SELECT ad_account_id AS adAccountId,
                last_collected_at AS lastCollectedAt,
                timezone_name AS timezoneName
            FROM meta_ad_accounts WHERE ad_account_id = ?
        `).get(String(adAccountId)) ?? null;
    }


    recordSnapshots({ account, accountKey, rows, observedAt, currentDate, currentPeriodEnd }) {
        const previousStatement = this.db.prepare(`
            SELECT spend_micros FROM spend_snapshots
            WHERE campaign_id = ? AND spend_date = ? AND observed_at < ?
            ORDER BY observed_at DESC LIMIT 1
        `);
        const campaignStatement = this.db.prepare(`
            INSERT INTO meta_campaigns (
                campaign_id, ad_account_id, name, currency, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_id) DO UPDATE SET
                ad_account_id = excluded.ad_account_id,
                name = excluded.name,
                currency = excluded.currency,
                last_seen_at = excluded.last_seen_at
        `);
        const snapshotStatement = this.db.prepare(`
            INSERT INTO spend_snapshots (
                campaign_id, spend_date, period_end, observed_at, spend_micros, delta_micros
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_id, spend_date, observed_at) DO UPDATE SET
                period_end = excluded.period_end,
                spend_micros = excluded.spend_micros,
                delta_micros = excluded.delta_micros
        `);
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.recordAdAccount(account, accountKey, observedAt);
            for (const row of rows) {
                const campaignId = String(row.campaignId ?? "").trim();
                const spendDate = normalizeDate(row.dateStart, currentDate);
                if (!campaignId) continue;
                const spendMicros = Number(row.spendMicros) || 0;
                const previous = previousStatement.get(campaignId, spendDate, observedAt);
                campaignStatement.run(
                    campaignId,
                    String(account.id),
                    String(row.campaignName ?? ""),
                    String(account.currency ?? ""),
                    observedAt,
                    observedAt
                );
                snapshotStatement.run(
                    campaignId,
                    spendDate,
                    spendDate === currentDate
                        ? currentPeriodEnd
                        : `${spendDate} 23:59:59`,
                    observedAt,
                    spendMicros,
                    spendMicros - Number(previous?.spend_micros ?? 0)
                );
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }


    replaceMappings(rows, seenAt) {
        const insert = this.db.prepare(`
            INSERT INTO keitaro_campaign_mapping (
                meta_campaign_id, keitaro_campaign_id, seen_at
            ) VALUES (?, ?, ?)
            ON CONFLICT(meta_campaign_id, keitaro_campaign_id)
            DO UPDATE SET seen_at = excluded.seen_at
        `);
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.exec("DELETE FROM keitaro_campaign_mapping");
            for (const row of rows) {
                if (row.metaCampaignId && row.keitaroCampaignId) {
                    insert.run(row.metaCampaignId, row.keitaroCampaignId, seenAt);
                }
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }


    getPendingExports() {
        return this.db.prepare(`
            WITH latest AS (
                SELECT snapshot.*
                FROM spend_snapshots snapshot
                JOIN (
                    SELECT campaign_id, spend_date, MAX(observed_at) AS observed_at
                    FROM spend_snapshots GROUP BY campaign_id, spend_date
                ) selected USING (campaign_id, spend_date, observed_at)
            ), unique_mapping AS (
                SELECT meta_campaign_id, MIN(keitaro_campaign_id) AS keitaro_campaign_id
                FROM keitaro_campaign_mapping
                GROUP BY meta_campaign_id HAVING COUNT(*) = 1
            )
            SELECT
                latest.campaign_id AS metaCampaignId,
                unique_mapping.keitaro_campaign_id AS keitaroCampaignId,
                latest.spend_date AS spendDate,
                latest.period_end AS periodEnd,
                latest.observed_at AS observedAt,
                latest.spend_micros AS spendMicros,
                ROUND(latest.spend_micros * (10000 + settings.commission_basis_points) / 10000.0) AS costMicros,
                settings.commission_basis_points AS commissionBasisPoints,
                campaign.currency,
                account.timezone_name AS timezoneName
            FROM latest
            JOIN unique_mapping ON unique_mapping.meta_campaign_id = latest.campaign_id
            JOIN meta_campaigns campaign ON campaign.campaign_id = latest.campaign_id
            JOIN meta_ad_accounts account ON account.ad_account_id = campaign.ad_account_id
            CROSS JOIN spend_settings settings
            LEFT JOIN keitaro_cost_exports exported
                ON exported.meta_campaign_id = latest.campaign_id
                AND exported.keitaro_campaign_id = unique_mapping.keitaro_campaign_id
                AND exported.spend_date = latest.spend_date
                AND exported.status = 'success'
            WHERE latest.spend_micros != COALESCE(exported.spend_micros, -1)
                OR settings.commission_basis_points != COALESCE(exported.commission_basis_points, -1)
            ORDER BY latest.spend_date, latest.campaign_id
        `).all();
    }


    recordExportAttempt(item, { ok, error = null, sentAt }) {
        this.db.prepare(`
            INSERT INTO keitaro_cost_exports (
                meta_campaign_id, keitaro_campaign_id, spend_date, spend_micros,
                exported_cost_micros, commission_basis_points,
                source_observed_at, status, attempts, sent_at, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(meta_campaign_id, keitaro_campaign_id, spend_date) DO UPDATE SET
                spend_micros = excluded.spend_micros,
                exported_cost_micros = excluded.exported_cost_micros,
                commission_basis_points = excluded.commission_basis_points,
                source_observed_at = excluded.source_observed_at,
                status = excluded.status,
                attempts = keitaro_cost_exports.attempts + 1,
                sent_at = excluded.sent_at,
                error = excluded.error
        `).run(
            item.metaCampaignId,
            item.keitaroCampaignId,
            item.spendDate,
            item.spendMicros,
            item.costMicros,
            item.commissionBasisPoints,
            item.observedAt,
            ok ? "success" : "failed",
            ok ? sentAt : null,
            error ? String(error) : null
        );
    }


    markRun(kind, at) {
        const field = kind === "export"
            ? "last_export_run_at"
            : "last_collection_run_at";
        this.db.prepare(`UPDATE spend_settings SET ${field} = ?, updated_at = ? WHERE id = 1`)
            .run(at, at);
    }


    getOverview() {
        const campaigns = this.db.prepare(`
            WITH latest AS (
                SELECT snapshot.*
                FROM spend_snapshots snapshot
                JOIN (
                    SELECT campaign_id, spend_date, MAX(observed_at) AS observed_at
                    FROM spend_snapshots GROUP BY campaign_id, spend_date
                ) selected USING (campaign_id, spend_date, observed_at)
            ), campaign_spend AS (
                SELECT campaign_id, SUM(spend_micros) AS spend_micros,
                    SUM(delta_micros) AS delta_micros, MAX(observed_at) AS observed_at
                FROM latest GROUP BY campaign_id
            ), mapping_count AS (
                SELECT meta_campaign_id, COUNT(*) AS count,
                    MIN(keitaro_campaign_id) AS keitaro_campaign_id
                FROM keitaro_campaign_mapping GROUP BY meta_campaign_id
            ), exported AS (
                SELECT meta_campaign_id, SUM(spend_micros) AS spend_micros,
                    SUM(exported_cost_micros) AS exported_cost_micros,
                    MIN(commission_basis_points) AS min_commission_basis_points,
                    MAX(commission_basis_points) AS max_commission_basis_points,
                    MAX(sent_at) AS sent_at
                FROM keitaro_cost_exports WHERE status = 'success'
                GROUP BY meta_campaign_id
            )
            SELECT campaign.campaign_id AS campaignId, campaign.name,
                campaign.ad_account_id AS adAccountId, campaign.currency,
                campaign_spend.spend_micros AS spendMicros,
                campaign_spend.delta_micros AS deltaMicros,
                campaign_spend.observed_at AS collectedAt,
                COALESCE(exported.spend_micros, 0) AS exportedMicros,
                COALESCE(exported.exported_cost_micros, 0) AS exportedCostMicros,
                settings.commission_basis_points AS commissionBasisPoints,
                exported.min_commission_basis_points AS minExportCommissionBasisPoints,
                exported.max_commission_basis_points AS maxExportCommissionBasisPoints,
                exported.sent_at AS exportedAt,
                COALESCE(mapping_count.count, 0) AS mappingCount,
                mapping_count.keitaro_campaign_id AS keitaroCampaignId
            FROM campaign_spend
            JOIN meta_campaigns campaign ON campaign.campaign_id = campaign_spend.campaign_id
            CROSS JOIN spend_settings settings
            LEFT JOIN mapping_count ON mapping_count.meta_campaign_id = campaign.campaign_id
            LEFT JOIN exported ON exported.meta_campaign_id = campaign.campaign_id
            ORDER BY campaign_spend.observed_at DESC, campaign.name
        `).all().map((row) => ({
            campaignId: row.campaignId,
            name: row.name,
            adAccountId: row.adAccountId,
            currency: row.currency,
            spend: fromMicros(row.spendMicros),
            spendWithCommission: fromMicros(addCommission(row.spendMicros, row.commissionBasisPoints)),
            lastDelta: fromMicros(row.deltaMicros),
            exported: fromMicros(row.exportedCostMicros),
            pending: fromMicros(
                addCommission(row.spendMicros, row.commissionBasisPoints) - row.exportedCostMicros
            ),
            collectedAt: row.collectedAt,
            exportedAt: row.exportedAt ?? null,
            mappingCount: row.mappingCount,
            keitaroCampaignId: row.mappingCount === 1 ? row.keitaroCampaignId : null,
            status: row.mappingCount === 0
                ? "mapping-missing"
                : row.mappingCount > 1
                    ? "mapping-ambiguous"
                    : row.spendMicros === row.exportedMicros
                        && row.minExportCommissionBasisPoints === row.commissionBasisPoints
                        && row.maxExportCommissionBasisPoints === row.commissionBasisPoints
                        ? "synced"
                        : "pending",
        }));
        const totals = campaigns.reduce((result, item) => ({
            spend: result.spend + item.spend,
            exported: result.exported + item.exported,
            pending: result.pending + item.pending,
        }), { spend: 0, exported: 0, pending: 0 });
        const totalsByCurrency = campaigns.reduce((result, item) => {
            const currency = item.currency || "—";
            const current = result[currency] ?? { spend: 0, exported: 0, pending: 0 };
            result[currency] = {
                spend: current.spend + item.spend,
                exported: current.exported + item.exported,
                pending: current.pending + item.pending,
            };
            return result;
        }, {});
        return { settings: this.getSettings(), totals, totalsByCurrency, campaigns };
    }


    close() {
        this.db?.close();
        this.db = null;
    }
}


export { defaultSpendSettings, normalizeSettings };
