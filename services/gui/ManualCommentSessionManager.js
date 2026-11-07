import { randomUUID } from "node:crypto";
import { prepareCommentsForCampaign } from "../creatives/prepareCreativeForCampaign.js";
import getProfileGender from "../profile/getProfileGender.js";
import getBlockedProfileTag from "../profile/tags/getBlockedProfileTag.js";
import markProfileAsBanned from "../profile/tags/markProfileAsBanned.js";
import { profileActivityTypes } from "../profile/ProfileActivityStore.js";
import { facebookAutomationWindowSize } from "../../facebook/browser/configureFacebookAutomationWindow.js";
import { shuffleArray } from "../../scenarios/runCommentingScenario.js";

const blockedTags = ["BAN", "LOGIN_ERROR"];
const actorKey = (row) => row.profile_key || `comment:${row.id}`;
const writable = (row) => !row.is_author && row.should_write !== false;

export default class ManualCommentSessionManager {
    constructor({ guiService, activityStore, copyText, creativeManager = null,
        getGender = getProfileGender, markBanned = markProfileAsBanned, random = Math.random }) {
        Object.assign(this, { guiService, activityStore, copyText, creativeManager, getGender, markBanned, random });
        this.tail = Promise.resolve();
    }

    execute(action, input = {}) {
        // Послідовна обробка захищає пул від подвійного призначення профілю.
        const operation = this.tail.then(() => this.run(action, input));
        this.tail = operation.catch(() => {});
        return operation;
    }

    async initialize() {
        await this.activityStore.initialize();
        this.db = this.activityStore.db;
        this.db.exec(`CREATE TABLE IF NOT EXISTS manual_comment_sessions (
            id TEXT PRIMARY KEY, context_key TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL, updated_at TEXT NOT NULL
        )`);
    }

    save(session) {
        session.updatedAt = new Date().toISOString();
        this.db.prepare(`INSERT INTO manual_comment_sessions (id, context_key, closed, state, updated_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
            closed = excluded.closed, state = excluded.state, updated_at = excluded.updated_at`)
            .run(session.id, session.contextKey, session.closed ? 1 : 0, JSON.stringify(session), session.updatedAt);
        return session;
    }

    load(id) {
        const stored = this.db.prepare("SELECT state FROM manual_comment_sessions WHERE id = ?").get(id);
        if (!stored) throw new Error("Ручний сеанс не знайдено");
        return JSON.parse(stored.state);
    }

    async run(action, input) {
        await this.initialize();
        if (action === "resume") {
            const stored = this.db.prepare(`SELECT state FROM manual_comment_sessions
                WHERE context_key = ? AND closed = 0 ORDER BY updated_at DESC LIMIT 1`).get(input.contextKey);
            return stored ? JSON.parse(stored.state) : null;
        }
        if (action === "start") return this.start(input);
        const session = this.load(input.sessionId);
        if (action === "get") return session;
        if (action === "finish") {
            session.finalizing = true;
            this.save(session);
            // Ключ події запобігає дублюванню статистики після збою або повторного закриття.
            for (const row of session.comments.filter((row) => row.status === "assumed")) {
                await this.activityStore.recordSuccessfulAction({
                    profileNo: row.profileNo, actionType: profileActivityTypes.MANUAL_COMMENT,
                    occurredAt: row.completedAt, eventKey: `manual:${session.id}:${row.id}`,
                });
            }
            session.closed = true;
            return this.save(session);
        }
        if (session.closed) throw new Error("Ручний сеанс уже завершено");
        if (session.finalizing) throw new Error("Завершення сеансу ще триває. Повторіть закриття вікна");
        const row = session.comments.find((item) => item.id === input.commentId);
        if (!row || !writable(row)) throw new Error("Цей коментар недоступний для ручних дій");
        if (action === "copy") {
            await this.copyText(row.text);
            return session;
        }
        if (action === "undo") {
            row.status = "notwritten";
            row.completedAt = null;
            return this.save(session);
        }
        if (!["open", "replace", "ban"].includes(action)) throw new Error("Невідома дія ручного коментування");
        const key = actorKey(row);
        const locked = session.comments.some((item) => item.id !== row.id
            && actorKey(item) === key && item.status === "assumed");
        if (action === "replace" && locked) throw new Error("Цей профіль уже написав інші репліки діалогу");
        if (["replace", "ban"].includes(action)) {
            const previousNo = session.assignments[key] || row.profileNo;
            if (!previousNo) throw new Error("Спочатку відкрийте профіль для коментаря");
            // Натискання заміни або бану одразу скасовує поточну невдалу спробу.
            row.status = "pending";
            row.completedAt = null;
            this.save(session);
            // Завжди пробуємо закрити локальний браузер незалежно від хмарного статусу.
            await this.guiService.closeAdsPowerProfile(previousNo);
            await this.copyText(row.text);
            if (action === "ban") {
                const profile = await this.guiService.adsPower.getProfileByNo(previousNo);
                await this.markBanned(this.guiService.adsPower, profile);
                await this.activityStore.markBanned(previousNo);
            }
            session.pool.find((item) => item.profileNo === previousNo).state = action === "ban" ? "banned" : "replaced";
            row.status = "pending";
            row.completedAt = null;
            row.profileNo = null;
            if (!locked) {
                delete session.assignments[key];
                for (const related of session.comments) {
                    if (actorKey(related) === key && related.status !== "assumed") {
                        related.profileNo = null;
                        if (related.status === "blocked") related.status = "pending";
                    }
                }
            }
            this.save(session);
            if (locked) {
                row.status = "blocked";
                return this.save(session);
            }
        }
        const mapped = session.assignments[key];
        if (mapped && ["banned", "unavailable"].includes(session.pool.find((item) => item.profileNo === mapped)?.state)) {
            row.status = "blocked";
            return this.save(session);
        }
        let candidate = mapped ? session.pool.find((item) => item.profileNo === mapped) : null;
        while (!candidate) {
            const next = session.pool.find((item) => item.state === "available" && item.gender === row.gender);
            if (!next) {
                this.save(session);
                throw new Error("У пулі немає доступного акаунта потрібної статі");
            }
            const profile = await this.guiService.adsPower.getProfileByNo(next.profileNo);
            if (getBlockedProfileTag(profile, blockedTags) || this.getGender(profile) !== row.gender) {
                next.state = "unavailable";
                this.save(session);
                continue;
            }
            candidate = next;
        }
        // Закріплюємо профіль до запуску: при помилці можна повторити відкриття або замінити його.
        session.assignments[key] = candidate.profileNo;
        candidate.state = "assigned";
        row.profileNo = candidate.profileNo;
        this.save(session);
        const profile = await this.guiService.adsPower.getProfileByNo(candidate.profileNo);
        const blockedTag = getBlockedProfileTag(profile, blockedTags);
        if (blockedTag || this.getGender(profile) !== row.gender) {
            candidate.state = blockedTag === "BAN" ? "banned" : "unavailable";
            if (row.status !== "assumed") row.status = "blocked";
            this.save(session);
            throw new Error("Прив’язаний профіль більше не відповідає тегам статі або має BAN / LOGIN_ERROR");
        }
        await this.guiService.openAdsPowerProfile(candidate.profileNo, {
            windowSize: facebookAutomationWindowSize,
        });
        await this.copyText(row.text);
        row.status = "assumed";
        row.completedAt ||= new Date().toISOString();
        return this.save(session);
    }

    async start(input) {
        const groupIds = [...new Set((input.groupIds ?? []).map(String).filter(Boolean))];
        const geo = String(input.creativeGeo || input.language || input.geo || "").trim();
        const creativeName = String(input.creativeName || "").trim().replace(/^Creo_/i, "");
        if (!input.contextKey || !geo || !creativeName || !groupIds.length) throw new Error("Вкажіть GEO, креатив і групи акаунтів");
        const existing = await this.run("resume", input);
        if (existing) return existing;
        const prepared = this.creativeManager
            ? prepareCommentsForCampaign({ creative: await this.creativeManager.getCreative(geo, creativeName), siteUrl: input.siteUrl ?? "" })
            : await this.guiService.prepareCommentingComments({ creativeGeo: geo, creativeName, siteUrl: input.siteUrl ?? "" });
        const comments = prepared
            .map((row, index) => ({ ...row, id: String(row.id ?? index + 1),
                parent_id: row.parent_id == null ? null : String(row.parent_id),
                status: "pending", profileNo: null, completedAt: null }));
        if (new Set(comments.map((row) => row.id)).size !== comments.length) throw new Error("Повторні ID коментарів у креативі");
        const genders = new Map();
        for (const row of comments.filter(writable)) {
            if (!["male", "female"].includes(row.gender)) throw new Error("У коментаря не вказана стать учасника");
            const key = actorKey(row);
            if (genders.has(key) && genders.get(key) !== row.gender) throw new Error("Учасник діалогу має різну стать у репліках");
            genders.set(key, row.gender);
        }
        const profiles = new Map();
        for (const groupId of groupIds) {
            const groupProfiles = await this.guiService.adsPower.getProfilesByGroupId(groupId);
            await this.activityStore.syncProfileGroups(groupProfiles);
            for (const profile of groupProfiles) {
                const gender = this.getGender(profile);
                if (!gender || getBlockedProfileTag(profile, blockedTags)) continue;
                profiles.set(String(profile.profile_no), { profileNo: String(profile.profile_no),
                    name: String(profile.name || ""), gender, state: "available" });
            }
        }
        return this.save({ id: randomUUID(), contextKey: input.contextKey, closed: false,
            settings: { geo: input.geo, language: input.language, creativeName, groupIds, siteUrl: input.siteUrl || "" },
            comments, pool: shuffleArray([...profiles.values()], this.random), assignments: {} });
    }
}
