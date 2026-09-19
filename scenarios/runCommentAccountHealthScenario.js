import checkFacebookCommentProfile
    from "../workflows/profile/checkFacebookCommentProfile.js";
import saveCommentAccountHealthReport
    from "../services/reports/saveCommentAccountHealthReport.js";


export default async function runCommentAccountHealthScenario({
    adsPower,
    profileNos = [],
    browserMode = "visible",
    disableImages = false,
    signal,
    onProgress,
    reportsDirectory = "./data/reports",
} = {}) {
    const numbers = [...new Set(profileNos.map((value) => String(value).trim()).filter(Boolean))];
    if (!numbers.length) throw new Error("Оберіть хоча б один профіль AdsPower");
    const report = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        profileNos: numbers,
        profiles: [],
    };
    for (const profileNo of numbers) {
        if (signal?.aborted) break;
        const startedAt = Date.now();
        let result;
        try {
            const profile = await adsPower.getProfileByNo(profileNo);
            result = await checkFacebookCommentProfile({
                adsPower,
                profile,
                browserMode,
                disableImages,
                signal,
            });
        } catch (error) {
            result = {
                profileNo,
                outcome: "error",
                login: "—",
                active: "—",
                english: "—",
                error: error.message,
            };
        }
        report.profiles.push({
            ...result,
            duration: `${Math.floor((Date.now() - startedAt) / 1000)} с`,
        });
        await onProgress?.({
            stage: "profile",
            completed: report.profiles.length,
            total: numbers.length,
            currentProfileNo: profileNo,
            message: `Перевірено профіль ${profileNo}`,
        });
    }
    report.finishedAt = new Date().toISOString();
    report.reportPath = await saveCommentAccountHealthReport(report, reportsDirectory);
    return report;
}
