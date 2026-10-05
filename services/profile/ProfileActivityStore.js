import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";


export const profileActivityTypes = Object.freeze({
    COMMENT_ACCOUNT_SETUP_UI: "comment_account_setup_ui",
    COMMENT_ACCOUNT_SETUP_API: "comment_account_setup_api",
    COMMENT_TASK: "comment_task",
    COMMENT_REACTIONS_TASK: "comment_reactions_task",
});


const counterColumns = Object.freeze({
    [profileActivityTypes.COMMENT_ACCOUNT_SETUP_UI]: "comment_account_setup_ui_count",
    [profileActivityTypes.COMMENT_ACCOUNT_SETUP_API]: "comment_account_setup_api_count",
    [profileActivityTypes.COMMENT_TASK]: "comment_task_count",
    [profileActivityTypes.COMMENT_REACTIONS_TASK]: "comment_reactions_task_count",
});

const accountTypes = ["regular", "ui", "api"];
const comparisonTasks = [
    { key: profileActivityTypes.COMMENT_TASK, label: "Комент-задачі, середнє" },
    { key: profileActivityTypes.COMMENT_REACTIONS_TASK, label: "Лайк-задачі, середнє" },
];

// Для забанених профілів тип фіксується за останнім оформленням до першого бану.
const classifiedProfiles = `WITH classified AS (
    SELECT p.*, COALESCE((
        SELECT CASE e.action_type
            WHEN 'comment_account_setup_ui' THEN 'ui' ELSE 'api' END
        FROM profile_activity_events e
        WHERE e.profile_no = p.profile_no
            AND e.action_type IN ('comment_account_setup_ui', 'comment_account_setup_api')
            AND e.outcome = 'success'
            AND (p.is_banned = 0 OR julianday(e.occurred_at) <= julianday(p.banned_at))
        ORDER BY julianday(e.occurred_at) DESC, e.id DESC LIMIT 1
    ), 'regular') AS account_type
    FROM profile_activity p
)`;

function normalizeComparisonDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Некоректна дата періоду статистики");
    return date.toISOString();
}


function normalizeProfileNo(value) {
    return String(value ?? "").trim();
}


function toProfile(row) {
    return {
        profileNo: row.profile_no,
        isBanned: Boolean(row.is_banned),
        accountType: row.account_type,
        adsPowerGroupId: row.adspower_group_id,
        adsPowerGroupName: row.adspower_group_name,
        bannedAt: row.banned_at,
        commentAccountSetupUiCount: Number(row.comment_account_setup_ui_count),
        commentAccountSetupApiCount: Number(row.comment_account_setup_api_count),
        commentTaskCount: Number(row.comment_task_count),
        commentReactionsTaskCount: Number(row.comment_reactions_task_count),
        totalTargetActions: Number(row.total_target_actions),
        lastTargetActionAt: row.last_target_action_at,
        updatedAt: row.updated_at,
    };
}


export default class ProfileActivityStore {
    constructor({ databaseFile = "./data/profile-activity/profile-activity.sqlite" } = {}) {
        this.databaseFile = databaseFile;
        this.db = null;
        this.initializing = null;
        this.profileGroups = new Map();
    }


    async initialize() {
        if (this.db) return this;
        if (this.initializing) return this.initializing;
        this.initializing = (async () => {
            await mkdir(path.dirname(this.databaseFile), { recursive: true });
            this.db = new DatabaseSync(this.databaseFile);
            this.db.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS profile_activity (
                    profile_no TEXT PRIMARY KEY,
                    is_banned INTEGER NOT NULL DEFAULT 0,
                    banned_at TEXT,
                    comment_account_setup_ui_count INTEGER NOT NULL DEFAULT 0,
                    comment_account_setup_api_count INTEGER NOT NULL DEFAULT 0,
                    comment_task_count INTEGER NOT NULL DEFAULT 0,
                    comment_reactions_task_count INTEGER NOT NULL DEFAULT 0,
                    total_target_actions INTEGER NOT NULL DEFAULT 0,
                    last_target_action_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS profile_activity_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_no TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    outcome TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    FOREIGN KEY (profile_no) REFERENCES profile_activity(profile_no) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS profile_activity_banned_updated
                    ON profile_activity(is_banned, updated_at DESC);
                CREATE INDEX IF NOT EXISTS profile_activity_events_profile
                    ON profile_activity_events(profile_no, occurred_at DESC);
            `);
            const columns = new Set(this.db.prepare("PRAGMA table_info(profile_activity)").all().map((column) => column.name));
            if (!columns.has("adspower_group_id")) this.db.exec("ALTER TABLE profile_activity ADD COLUMN adspower_group_id TEXT");
            if (!columns.has("adspower_group_name")) this.db.exec("ALTER TABLE profile_activity ADD COLUMN adspower_group_name TEXT");
            if (!columns.has("track_adspower_group")) {
                // Старі записи починають оновлювати групу після наступної виконаної задачі.
                this.db.exec("ALTER TABLE profile_activity ADD COLUMN track_adspower_group INTEGER NOT NULL DEFAULT 1");
                this.db.exec("UPDATE profile_activity SET track_adspower_group = 0");
            }
            this.db.exec(`UPDATE profile_activity
                SET total_target_actions = comment_task_count + comment_reactions_task_count
                WHERE total_target_actions != comment_task_count + comment_reactions_task_count`);
            return this;
        })();
        try {
            return await this.initializing;
        } finally {
            this.initializing = null;
        }
    }


    async syncProfileGroups(profiles = []) {
        await this.initialize();
        const update = this.db.prepare(`UPDATE profile_activity
            SET adspower_group_id = ?, adspower_group_name = ?
            WHERE profile_no = ? AND is_banned = 0 AND track_adspower_group = 1`);
        this.db.exec("BEGIN IMMEDIATE");
        try {
            for (const profile of profiles) {
                const profileNo = normalizeProfileNo(profile?.profile_no);
                const groupId = String(profile?.group_id ?? "").trim();
                if (!profileNo || !groupId) continue;
                const group = { id: groupId, name: String(profile.group_name ?? "").trim() };
                this.profileGroups.set(profileNo, group);
                update.run(group.id, group.name, profileNo);
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }


    async recordSuccessfulAction({ profileNo, actionType, outcome = "success", occurredAt = new Date().toISOString() } = {}) {
        const normalizedProfileNo = normalizeProfileNo(profileNo);
        const column = counterColumns[actionType];
        if (!normalizedProfileNo || !column) return false;
        await this.initialize();
        const group = this.profileGroups.get(normalizedProfileNo);
        const taskIncrement = [profileActivityTypes.COMMENT_TASK, profileActivityTypes.COMMENT_REACTIONS_TASK].includes(actionType) ? 1 : 0;
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.prepare(`
                INSERT INTO profile_activity (profile_no, created_at, updated_at, adspower_group_id, adspower_group_name)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(profile_no) DO NOTHING
            `).run(normalizedProfileNo, occurredAt, occurredAt, group?.id ?? null, group?.name ?? null);
            // Виконана задача дозволяє оновлювати групу і для старого незабаненого профілю.
            this.db.prepare(`
                UPDATE profile_activity SET
                    track_adspower_group = 1,
                    adspower_group_id = COALESCE(?, adspower_group_id),
                    adspower_group_name = COALESCE(?, adspower_group_name)
                WHERE profile_no = ? AND is_banned = 0
            `).run(group?.id ?? null, group?.name ?? null, normalizedProfileNo);
            this.db.prepare(`
                UPDATE profile_activity SET
                    ${column} = ${column} + 1,
                    total_target_actions = total_target_actions + ${taskIncrement},
                    last_target_action_at = ?,
                    updated_at = ?
                WHERE profile_no = ?
            `).run(occurredAt, occurredAt, normalizedProfileNo);
            this.db.prepare(`
                INSERT INTO profile_activity_events (profile_no, action_type, outcome, occurred_at)
                VALUES (?, ?, ?, ?)
            `).run(normalizedProfileNo, actionType, outcome, occurredAt);
            this.db.exec("COMMIT");
            return true;
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }


    async markBanned(profileNo, bannedAt = new Date().toISOString()) {
        const normalizedProfileNo = normalizeProfileNo(profileNo);
        if (!normalizedProfileNo) return false;
        await this.initialize();
        const group = this.profileGroups.get(normalizedProfileNo);
        this.db.prepare(`
            INSERT INTO profile_activity (profile_no, is_banned, banned_at, created_at, updated_at, adspower_group_id, adspower_group_name)
            VALUES (?, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(profile_no) DO UPDATE SET
                is_banned = 1,
                banned_at = COALESCE(profile_activity.banned_at, excluded.banned_at),
                updated_at = excluded.updated_at
        `).run(normalizedProfileNo, bannedAt, bannedAt, bannedAt, group?.id ?? null, group?.name ?? null);
        return true;
    }


    async list({ bannedOnly = true, sortByDate = true, page = 1, pageSize = 50,
        includedAccountTypes = accountTypes, comparisonDateFrom, comparisonDateTo } = {}) {
        await this.initialize();
        const normalizedPageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
        const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
        const includedTypes = accountTypes.filter((type) => includedAccountTypes.includes(type));
        const where = `WHERE ${bannedOnly ? "is_banned = 1 AND " : ""}
            account_type IN (${includedTypes.map(() => "?").join(", ") || "NULL"})`;
        const orderBy = sortByDate
            ? "updated_at DESC, profile_no DESC"
            : "total_target_actions DESC, updated_at DESC, profile_no DESC";
        const total = Number(this.db.prepare(`${classifiedProfiles} SELECT COUNT(*) AS total FROM classified ${where}`).get(...includedTypes).total);
        const rows = this.db.prepare(`
            ${classifiedProfiles} SELECT * FROM classified ${where}
            ORDER BY ${orderBy} LIMIT ? OFFSET ?
        `).all(...includedTypes, normalizedPageSize, (normalizedPage - 1) * normalizedPageSize);
        return {
            items: rows.map(toProfile),
            total,
            page: normalizedPage,
            pageSize: normalizedPageSize,
            totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
            comparison: await this.compareBanned({ dateFrom: comparisonDateFrom, dateTo: comparisonDateTo }),
        };
    }


    async compareBanned({ dateFrom, dateTo } = {}) {
        await this.initialize();
        const from = normalizeComparisonDate(dateFrom);
        const to = normalizeComparisonDate(dateTo);
        if (from && to && from > to) throw new Error("Дата «Від» має бути не пізніше дати «До»");
        const conditions = ["p.is_banned = 1"];
        const parameters = [];
        if (from) { conditions.push("julianday(p.banned_at) >= julianday(?)"); parameters.push(from); }
        if (to) { conditions.push("julianday(p.banned_at) <= julianday(?)"); parameters.push(to); }
        // Події після бану не входять у середнє; акаунти без задач враховуються як нуль.
        const averages = comparisonTasks.map(({ key }, index) => `AVG((
            SELECT COUNT(*) FROM profile_activity_events e
            WHERE e.profile_no = p.profile_no AND e.action_type = '${key}'
                AND e.outcome IN ('success', 'completed_with_warnings')
                AND julianday(e.occurred_at) <= julianday(p.banned_at)
        )) AS average_${index}`);
        const rows = this.db.prepare(`
            ${classifiedProfiles}
            SELECT p.account_type, COUNT(*) AS banned_count, ${averages.join(", ")}
            FROM classified p WHERE ${conditions.join(" AND ")} GROUP BY p.account_type
        `).all(...parameters);
        return {
            tasks: comparisonTasks,
            groups: accountTypes.map((accountType) => {
                const row = rows.find((item) => item.account_type === accountType);
                return {
                    accountType,
                    bannedCount: Number(row?.banned_count ?? 0),
                    averages: Object.fromEntries(comparisonTasks.map(({ key }, index) =>
                        [key, row ? Number(row[`average_${index}`]) : null])),
                };
            }),
        };
    }


    async remove(profileNos = []) {
        const values = [...new Set(profileNos.map(normalizeProfileNo).filter(Boolean))];
        if (!values.length) return 0;
        await this.initialize();
        const placeholders = values.map(() => "?").join(", ");
        const result = this.db.prepare(`DELETE FROM profile_activity WHERE profile_no IN (${placeholders})`).run(...values);
        return Number(result.changes ?? 0);
    }
}


export const defaultProfileActivityStore = new ProfileActivityStore();
