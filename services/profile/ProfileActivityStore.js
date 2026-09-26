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


function normalizeProfileNo(value) {
    return String(value ?? "").trim();
}


function toProfile(row) {
    return {
        profileNo: row.profile_no,
        isBanned: Boolean(row.is_banned),
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
            return this;
        })();
        try {
            return await this.initializing;
        } finally {
            this.initializing = null;
        }
    }


    async recordSuccessfulAction({ profileNo, actionType, outcome = "success", occurredAt = new Date().toISOString() } = {}) {
        const normalizedProfileNo = normalizeProfileNo(profileNo);
        const column = counterColumns[actionType];
        if (!normalizedProfileNo || !column) return false;
        await this.initialize();
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db.prepare(`
                INSERT INTO profile_activity (profile_no, created_at, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(profile_no) DO NOTHING
            `).run(normalizedProfileNo, occurredAt, occurredAt);
            this.db.prepare(`
                UPDATE profile_activity SET
                    ${column} = ${column} + 1,
                    total_target_actions = total_target_actions + 1,
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
        this.db.prepare(`
            INSERT INTO profile_activity (profile_no, is_banned, banned_at, created_at, updated_at)
            VALUES (?, 1, ?, ?, ?)
            ON CONFLICT(profile_no) DO UPDATE SET
                is_banned = 1,
                banned_at = COALESCE(profile_activity.banned_at, excluded.banned_at),
                updated_at = excluded.updated_at
        `).run(normalizedProfileNo, bannedAt, bannedAt, bannedAt);
        return true;
    }


    async list({ bannedOnly = true, sortByDate = true, page = 1, pageSize = 50 } = {}) {
        await this.initialize();
        const normalizedPageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
        const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
        const where = bannedOnly ? "WHERE is_banned = 1" : "";
        const orderBy = sortByDate
            ? "updated_at DESC, profile_no DESC"
            : "total_target_actions DESC, updated_at DESC, profile_no DESC";
        const total = Number(this.db.prepare(`SELECT COUNT(*) AS total FROM profile_activity ${where}`).get().total);
        const rows = this.db.prepare(`
            SELECT * FROM profile_activity ${where}
            ORDER BY ${orderBy} LIMIT ? OFFSET ?
        `).all(normalizedPageSize, (normalizedPage - 1) * normalizedPageSize);
        return {
            items: rows.map(toProfile),
            total,
            page: normalizedPage,
            pageSize: normalizedPageSize,
            totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
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
