import { classifyPhotoFiles, getProfilePhotoRejectReason } from "../accounts/photoSets.js";
import createBackdatedSchedule from "../pageRebuild/createBackdatedSchedule.js";

// Перевіряє весь набір до першої зміни у Facebook.
export default async function prepareFanPagePhotos({ imagePaths = [], changeDates = false, minimumDate = "" } = {}) {
    const { avatarCandidate, coverCandidate, rest, all } = classifyPhotoFiles([...new Set(imagePaths)]);
    const avatar = avatarCandidate ?? rest.shift();
    const cover = coverCandidate ?? rest.shift();
    if (!avatar || !cover || all.length < 2) throw new Error("Виберіть щонайменше два фото: 1 — аватарка, 2 — обкладинка");
    for (const [file, role] of [[avatar, "avatar"], [cover, "cover"], ...rest.map((file) => [file, "post"])]) {
        const reason = await getProfilePhotoRejectReason(file, role);
        if (reason) throw new Error(`${role === "avatar" ? "Аватарка" : role === "cover" ? "Обкладинка" : "Фото-пост"}: ${reason}`);
    }
    let dates = [];
    if (changeDates) {
        const start = Date.parse(`${minimumDate}T00:00:00Z`);
        const today = Date.parse(new Date().toISOString().slice(0, 10));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(minimumDate) || !Number.isFinite(start)
            || new Date(start).toISOString().slice(0, 10) !== minimumDate || start > today) {
            throw new Error("Вкажіть коректну мінімальну дату в минулому");
        }
        if (rest.length > Math.floor((today - start) / 86400000) + 1) throw new Error("У діапазоні замало днів для вибраних фото");
        dates = rest.length ? createBackdatedSchedule({ count: rest.length, pageCreatedAt: minimumDate })
            .map((date) => date.slice(0, 10)) : [];
    }
    return [
        { action: "avatar", imagePath: avatar, label: "Аватарка" },
        { action: "cover", imagePath: cover, label: "Обкладинка" },
        { action: "clearPosts", label: "Очищення попередніх постів і фото у стрічці" },
        ...rest.map((imagePath, index) => ({ action: "post", imagePath, date: dates[index] ?? "", label: `Фото-пост ${index + 1}` })),
    ];
}
