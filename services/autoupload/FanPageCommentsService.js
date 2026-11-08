import getProfileGender from "../profile/getProfileGender.js";
import getBlockedProfileTag from "../profile/tags/getBlockedProfileTag.js";
import commentBatchInput from "./commentBatchInput.js";

export default class FanPageCommentsService {
    constructor({ adsPower, guiService, autoupload }) {
        Object.assign(this, { adsPower, guiService, autoupload });
    }

    async profiles() {
        return (await this.adsPower.getProfiles()).flatMap(profile => {
            const gender = getProfileGender(profile);
            if (!gender || getBlockedProfileTag(profile, ["BAN", "LOGIN_ERROR"])) return [];
            return [{ profileId: String(profile.profile_id), profileNo: String(profile.profile_no), name: String(profile.name || ""), gender }];
        });
    }

    async prepare(input) {
        if (!String(input.creativeGeo || input.language || input.geo || "").trim() || !String(input.creativeName || "").trim()) {
            throw new Error("Оберіть мову та креатив");
        }
        const comments = (await this.guiService.prepareCommentingComments({ ...input, commentTarget: "post" }))
            .filter(row => row.parent_id == null && !row.is_author && row.should_write !== false);
        if (comments.some(row => !["male", "female"].includes(row.gender))) throw new Error("У коментаря не вказана стать");
        let postUrl = input.postUrl;
        try {
            const url = new URL(postUrl);
            const match = url.pathname.match(/^\/([^/]+)\/posts\/(pfbid[A-Za-z0-9]+|[1-9]\d*)\/?$/);
            if (url.protocol === "https:" && ["www.facebook.com", "facebook.com"].includes(url.hostname) && match) {
                postUrl = `https://www.facebook.com/permalink.php?story_fbid=${match[2]}&id=${encodeURIComponent(match[1])}`;
            }
        } catch { /* Валідація нижче повертає користувачу помилку адреси. */ }
        return { ...commentBatchInput({ postUrl, comments: comments.map(row => row.text) }), commentRows: comments };
    }

    async selected(ids) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error("Оберіть від 1 до 1000 профілів");
        const pool = new Map((await this.profiles()).map(profile => [profile.profileId, profile]));
        const profiles = [...new Set(ids.map(String))].map(id => pool.get(id));
        if (profiles.some(profile => !profile)) throw new Error("Список профілів змінився. Завантажте акаунти повторно");
        return profiles;
    }

    async run(profiles, prepared, context) {
        // Перед виконанням повторно перевіряємо теги, не змінюючи проксі профілів.
        const current = await this.selected(profiles.map(profile => profile.profileId));
        return this.autoupload.publishComments(current.map(profile => profile.profileId), prepared, {
            ...context, profiles: current, commentRows: prepared.commentRows,
        });
    }
}
