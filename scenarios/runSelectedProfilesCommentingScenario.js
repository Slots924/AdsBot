import runParallelCommentingScenario from "./runParallelCommentingScenario.js";


export function parseManualComments(text) {
    return String(text ?? "").split(/\r\n|\n|\r/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => ({
            id: String(index + 1),
            parent_id: null,
            profile_key: null,
            gender: null,
            should_write: true,
            text: line,
        }));
}


export default async function runSelectedProfilesCommentingScenario({
    profileNos,
    manualMode = false,
    manualComments = "",
    comments,
    ...options
} = {}) {
    if (!Array.isArray(profileNos) || !profileNos.some((number) => String(number ?? "").trim())) {
        throw new Error("Оберіть хоча б один профіль AdsPower");
    }
    const queue = manualMode ? parseManualComments(manualComments) : comments;
    if (!Array.isArray(queue) || !queue.length) throw new Error("Немає коментарів для публікації");
    return runParallelCommentingScenario({
        ...options,
        groupIds: [],
        profileNos,
        matchProfileGender: !manualMode,
        comments: queue,
        geo: manualMode ? "MANUAL" : options.geo,
        creativeName: manualMode ? "Ручні коментарі" : options.creativeName,
    });
}
