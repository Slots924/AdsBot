import { randomUUID } from "node:crypto";
import { normalizeFarmSettings, normalizeFacebookGroup } from "./farmSettings.js";
import { seedFarmGroups } from "./seedGroups.js";

const now = () => new Date().toISOString();
const decode = (row) => row ? JSON.parse(row.data) : null;

// Таблиці фарму не залежать від видалення записів старого журналу активності.
export default class FarmStore {
    constructor(activityStore) { this.activityStore = activityStore; }

    initialize() {
        const db = this.activityStore.db;
        db.exec(`
            CREATE TABLE IF NOT EXISTS farm_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', deleted_at TEXT, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS farm_members (profile_no TEXT PRIMARY KEY, group_id TEXT REFERENCES farm_groups(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS farm_membership_history (id INTEGER PRIMARY KEY, profile_no TEXT NOT NULL, from_group TEXT, to_group TEXT, occurred_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS farm_runs (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES farm_groups(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS farm_sessions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES farm_runs(id), profile_no TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS farm_sessions_profile ON farm_sessions(profile_no);
            CREATE INDEX IF NOT EXISTS farm_sessions_run ON farm_sessions(run_id);
            CREATE INDEX IF NOT EXISTS farm_runs_group ON farm_runs(group_id);
            CREATE TABLE IF NOT EXISTS farm_config (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        `);
        db.prepare("INSERT OR IGNORE INTO farm_config VALUES ('pool', ?)").run(JSON.stringify(seedFarmGroups));
    }

    async database() { await this.activityStore.initialize(); return this.activityStore.db; }
    async settings() {
        const db = await this.database();
        return normalizeFarmSettings(decode(db.prepare("SELECT data FROM farm_config WHERE id = 'settings'").get()) ?? {});
    }
    async saveSettings(value) {
        const settings = normalizeFarmSettings(value);
        (await this.database()).prepare("INSERT OR REPLACE INTO farm_config VALUES ('settings', ?)").run(JSON.stringify(settings));
        return settings;
    }
    async pool() {
        return decode((await this.database()).prepare("SELECT data FROM farm_config WHERE id = 'pool'").get()) ?? [];
    }
    async savePool(input) {
        if (!Array.isArray(input)) throw new Error("Некоректний пул груп");
        const groups = input.map((item) => ({ ...normalizeFacebookGroup(item), id: String(item.id || randomUUID()) }));
        if (new Set(groups.map((item) => item.id)).size !== groups.length) throw new Error("У пулі є повторні ID груп");
        if (new Set(groups.map((item) => item.url)).size !== groups.length) throw new Error("У пулі є повторні URL груп");
        (await this.database()).prepare("INSERT OR REPLACE INTO farm_config VALUES ('pool', ?)").run(JSON.stringify(groups));
        return groups;
    }
    async saveGroup({ id, name, notes = "" }) {
        name = String(name ?? "").trim();
        if (!name) throw new Error("Вкажіть назву групи фарму");
        const db = await this.database();
        if (id) {
            const changed = db.prepare("UPDATE farm_groups SET name = ?, notes = ? WHERE id = ? AND deleted_at IS NULL").run(name, String(notes), id);
            if (!changed.changes) throw new Error("Групу не знайдено");
        } else {
            id = randomUUID();
            db.prepare("INSERT INTO farm_groups (id, name, notes, created_at) VALUES (?, ?, ?, ?)").run(id, name, String(notes), now());
        }
        return { id, name, notes: String(notes) };
    }
    async requireGroup(id) {
        const row = (await this.database()).prepare("SELECT * FROM farm_groups WHERE id = ? AND deleted_at IS NULL").get(String(id));
        if (!row) throw new Error("Групу фарму не знайдено");
        return row;
    }
    async assign(groupId, profiles) {
        if (groupId) await this.requireGroup(groupId);
        const db = await this.database();
        const stamp = now();
        db.exec("BEGIN IMMEDIATE");
        try {
            for (const profile of profiles) {
                const profileNo = String(profile.profileNo ?? "").trim();
                if (!profileNo) throw new Error("Не вказано номер профілю");
                const existing = db.prepare("SELECT * FROM farm_members WHERE profile_no = ?").get(profileNo);
                const data = { ...decode(existing), ...profile, profileNo };
                if ((existing?.group_id ?? null) !== (groupId || null)) {
                    db.prepare("INSERT INTO farm_membership_history (profile_no, from_group, to_group, occurred_at) VALUES (?, ?, ?, ?)")
                        .run(profileNo, existing?.group_id ?? null, groupId || null, stamp);
                }
                db.prepare("INSERT OR REPLACE INTO farm_members VALUES (?, ?, ?)").run(profileNo, groupId || null, JSON.stringify(data));
            }
            db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        return { assigned: profiles.length };
    }
    async updateProfile(profileNo, patch) {
        const db = await this.database();
        const row = db.prepare("SELECT * FROM farm_members WHERE profile_no = ?").get(String(profileNo));
        if (row) db.prepare("UPDATE farm_members SET data = ? WHERE profile_no = ?").run(JSON.stringify({ ...decode(row), ...patch }), String(profileNo));
    }
    async updateProfileById(profileId, patch) {
        const db = await this.database();
        const row = db.prepare("SELECT * FROM farm_members WHERE json_extract(data, '$.profileId') = ?").get(String(profileId));
        if (row) await this.updateProfile(row.profile_no, patch);
    }
    async deleteGroup(id) {
        await this.requireGroup(id);
        const db = await this.database();
        const stamp = now();
        db.exec("BEGIN IMMEDIATE");
        try {
            db.prepare("INSERT INTO farm_membership_history (profile_no, from_group, to_group, occurred_at) SELECT profile_no, group_id, NULL, ? FROM farm_members WHERE group_id = ?").run(stamp, id);
            db.prepare("UPDATE farm_members SET group_id = NULL WHERE group_id = ?").run(id);
            db.prepare("UPDATE farm_groups SET deleted_at = ? WHERE id = ?").run(stamp, id);
            db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        return { deleted: true };
    }
    async members(groupId) {
        const db = await this.database();
        return db.prepare("SELECT * FROM farm_members WHERE group_id = ? ORDER BY profile_no").all(groupId).map((row) => {
            const activity = db.prepare("SELECT * FROM profile_activity WHERE profile_no = ?").get(row.profile_no);
            const sessions = db.prepare(`SELECT json_extract(data, '$.farmStartedAt') AS farmStartedAt,
                json_extract(data, '$.farmFinishedAt') AS farmFinishedAt, json_extract(data, '$.farmTimeMs') AS farmTimeMs,
                json_extract(data, '$.outcome') AS outcome FROM farm_sessions WHERE profile_no = ?`).all(row.profile_no);
            const started = sessions.filter((s) => s.farmStartedAt);
            const first = started.map((s) => s.farmStartedAt).sort()[0] ?? null;
            const last = started.map((s) => s.farmFinishedAt ?? s.farmStartedAt).sort().at(-1) ?? null;
            return { ...decode(row), groupId: row.group_id, isBanned: Boolean(activity?.is_banned), bannedAt: activity?.banned_at,
                accountType: activity?.creation_type_id ?? "regular",
                commentTaskCount: activity?.comment_task_count ?? 0, reactionTaskCount: activity?.comment_reactions_task_count ?? 0,
                farmSessionCount: started.length, farmTimeMs: started.reduce((sum, s) => sum + (s.farmTimeMs ?? 0), 0),
                farmFirstAt: first, farmLastAt: last, farmPeriodMs: first ? Math.max(0, Date.parse(last) - Date.parse(first)) : null,
                outcomes: Object.fromEntries(["completed", "timeout", "failed", "cancelled", "interrupted", "running", "check_failed", "skipped"].map((key) => [key, sessions.filter((s) => s.outcome === key).length])) };
        });
    }
    async groups() {
        const rows = (await this.database()).prepare("SELECT * FROM farm_groups WHERE deleted_at IS NULL ORDER BY created_at, id").all();
        return Promise.all(rows.map(async (row) => {
            const members = await this.members(row.id);
            const sum = (key) => members.reduce((total, member) => total + Number(member[key] ?? 0), 0);
            const totals = Object.fromEntries(["commentTaskCount", "reactionTaskCount", "farmSessionCount", "farmTimeMs"].map((key) => [key, sum(key)]));
            const first = members.map((m) => m.farmFirstAt).filter(Boolean).sort()[0] ?? null;
            const last = members.map((m) => m.farmLastAt).filter(Boolean).sort().at(-1) ?? null;
            return { id: row.id, name: row.name, notes: row.notes, count: members.length, banned: members.filter((m) => m.isBanned).length,
                bannedPercent: members.length ? members.filter((m) => m.isBanned).length / members.length * 100 : 0,
                creationTypeCounts: Object.fromEntries(["ui", "api", "autoupload", "regular"].map(type => [type, members.filter(member => member.accountType === type).length])),
                totals, averages: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, members.length ? value / members.length : 0])),
                outcomes: Object.fromEntries(["completed", "timeout", "failed", "cancelled", "interrupted", "running", "check_failed", "skipped"].map((key) => [key, members.reduce((count, member) => count + member.outcomes[key], 0)])),
                farmFirstAt: first, farmLastAt: last, farmPeriodMs: first ? Date.parse(last) - Date.parse(first) : null };
        }));
    }
    async history(groupId) {
        const db = await this.database();
        return { runs: db.prepare("SELECT data FROM farm_runs WHERE group_id = ? ORDER BY rowid DESC LIMIT 100").all(groupId).map((row) => {
            const run = decode(row);
            return { ...run, sessions: db.prepare("SELECT data FROM farm_sessions WHERE run_id = ? ORDER BY rowid").all(run.id).map(decode) };
        }), memberships: db.prepare("SELECT * FROM farm_membership_history WHERE from_group = ? OR to_group = ? ORDER BY id DESC LIMIT 200").all(groupId, groupId) };
    }
    async createRun(groupId, profiles, settings, pool) {
        await this.requireGroup(groupId);
        const run = { id: randomUUID(), groupId, profileNos: profiles.map((p) => p.profileNo), settings, pool, startedAt: now(), outcome: "running" };
        (await this.database()).prepare("INSERT INTO farm_runs VALUES (?, ?, ?)").run(run.id, groupId, JSON.stringify(run));
        return run;
    }
    async saveRun(run) {
        (await this.database()).prepare("UPDATE farm_runs SET data = ? WHERE id = ?").run(JSON.stringify(run), run.id);
    }
    async saveSession(session) {
        (await this.database()).prepare("INSERT OR REPLACE INTO farm_sessions VALUES (?, ?, ?, ?)").run(session.id, session.runId, session.profileNo, JSON.stringify(session));
    }
    async recoverInterrupted() {
        const db = await this.database();
        for (const table of ["farm_runs", "farm_sessions"]) {
            for (const row of db.prepare(`SELECT id, data FROM ${table}`).all()) {
                const item = decode(row);
                if (item.outcome !== "running") continue;
                // Після аварії враховуємо лише час до останнього збереженого кроку.
                item.outcome = "interrupted";
                item.finishedAt = item.updatedAt ?? item.startedAt;
                if (item.farmStartedAt) item.farmFinishedAt = item.updatedAt ?? item.farmStartedAt;
                db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(item), row.id);
            }
        }
    }
}
