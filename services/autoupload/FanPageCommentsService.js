import getProfileGender from "../profile/getProfileGender.js";
import getBlockedProfileTag from "../profile/tags/getBlockedProfileTag.js";
import commentBatchInput from "./commentBatchInput.js";
import { prepareDialogue } from "./commentDialogue.js";

export default class FanPageCommentsService {
    constructor({ adsPower, guiService, autoupload }) {
        Object.assign(this, { adsPower, guiService, autoupload });
    }

    groupIds(value) {
        if (!Array.isArray(value)) throw new Error("Оберіть групи акаунтів для AU Comments");
        const ids = [...new Set(value.map(id => String(id ?? "").trim()).filter(Boolean))];
        if (!ids.length) throw new Error("Оберіть групи акаунтів для AU Comments");
        return ids;
    }

    async profiles(groupIds) {
        const pool = new Map();
        for (const groupId of this.groupIds(groupIds)) {
            for (const profile of await this.adsPower.getProfilesByGroupId(groupId)) {
                pool.set(String(profile.profile_id), profile);
            }
        }
        return [...pool.values()].flatMap(profile => {
            const gender = getProfileGender(profile);
            if (!gender || getBlockedProfileTag(profile, ["BAN", "LOGIN_ERROR"])) return [];
            return [{ profileId: String(profile.profile_id), profileNo: String(profile.profile_no), name: String(profile.name || ""), gender }];
        });
    }

    async prepare(input) {
        const groupIds = this.groupIds(input.groupIds);
        if (!String(input.creativeGeo || input.language || input.geo || "").trim() || !String(input.creativeName || "").trim()) {
            throw new Error("Оберіть мову та креатив");
        }
        const comments = prepareDialogue(await this.guiService.prepareCommentingComments({ ...input, commentTarget: "post" }));
        let postUrl = input.postUrl;
        try {
            const url = new URL(postUrl);
            const match = url.pathname.match(/^\/([^/]+)\/posts\/(pfbid[A-Za-z0-9]+|[1-9]\d*)\/?$/);
            if (url.protocol === "https:" && ["www.facebook.com", "facebook.com"].includes(url.hostname) && match) {
                postUrl = `https://www.facebook.com/permalink.php?story_fbid=${match[2]}&id=${encodeURIComponent(match[1])}`;
            }
        } catch { /* Валідація нижче повертає користувачу помилку адреси. */ }
        const writable = comments.filter(row => !row.is_author && row.should_write !== false);
        if (!writable.length) throw new Error("Немає коментарів для публікації");
        return { ...commentBatchInput({ postUrl, comments: writable.map(row => row.text.replace(/[\r\n]+/g, ' ')) }), commentRows: comments, groupIds };
    }

    async selected(ids, groupIds) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error("Оберіть від 1 до 1000 профілів");
        const pool = new Map((await this.profiles(groupIds)).map(profile => [profile.profileId, profile]));
        const profiles = [...new Set(ids.map(String))].map(id => pool.get(id));
        if (profiles.some(profile => !profile)) throw new Error("Список профілів змінився. Завантажте акаунти повторно");
        return profiles;
    }

    async run(profiles, prepared, context) {
        // Перед виконанням повторно перевіряємо теги, не змінюючи проксі профілів.
        const current = await this.selected(profiles.map(profile => profile.profileId), prepared.groupIds);
        return this.autoupload.publishDialogue(current.map(profile => profile.profileId), prepared, {
            ...context, profiles: current, commentRows: prepared.commentRows,
        });
    }
}
