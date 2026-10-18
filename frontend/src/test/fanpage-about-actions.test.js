import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateEducationField, updateWorkField } from "../../../facebook/api-workflows/profile/fillProfileAbout.js";
import { buildEducationSaveVariables } from "../../../facebook/api-actions/education/educationSave.js";
import { buildWorkExperienceSaveVariables } from "../../../facebook/api-actions/workplace/workExperienceSave.js";

const actions = vi.hoisted(() => Object.fromEntries([
    "getEducation", "addEducation", "saveEducation", "searchCollege", "fallbackEducation",
    "getWork", "searchWorkplace", "searchJobTitle", "createWork", "createCustomWork", "deleteWork", "fallbackWork",
].map((key) => [key, vi.fn()])));
vi.mock("../../../facebook/api-actions/education/getEducationExperiences.js", () => ({ default: actions.getEducation }));
vi.mock("../../../facebook/api-actions/education/addEducation.js", () => ({ default: actions.addEducation }));
vi.mock("../../../facebook/api-actions/education/updateEducation.js", () => ({ default: actions.saveEducation }));
vi.mock("../../../facebook/api-actions/education/searchCollege.js", () => ({ default: actions.searchCollege }));
vi.mock("../../../facebook/api-actions/education/addFallbackEducation.js", () => ({ default: actions.fallbackEducation }));
vi.mock("../../../facebook/api-actions/workplace/getWorkExperiences.js", () => ({ default: actions.getWork }));
vi.mock("../../../facebook/api-actions/workplace/searchWorkplace.js", () => ({ default: actions.searchWorkplace }));
vi.mock("../../../facebook/api-actions/workplace/searchJobTitle.js", () => ({ default: actions.searchJobTitle }));
vi.mock("../../../facebook/api-actions/workplace/createWorkExperience.js", () => ({ default: actions.createWork }));
vi.mock("../../../facebook/api-actions/workplace/createCustomWorkExperience.js", () => ({ default: actions.createCustomWork }));
vi.mock("../../../facebook/api-actions/workplace/deleteWorkExperience.js", () => ({ default: actions.deleteWork }));
vi.mock("../../../facebook/api-actions/workplace/addFallbackWorkExperience.js", () => ({ default: actions.fallbackWork }));

const tokens = { collectionToken: "collection", sectionToken: "section", rawSectionToken: "raw" };
const options = () => ({ page: {}, tokens, replaceExisting: true, allowFallback: false, beforeAction: vi.fn() });
beforeEach(() => {
    for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ success: true, status: "SAVED", data: [] });
    actions.searchCollege.mockResolvedValue({ success: true, data: [{ fbid: "321", value: "College" }] });
    actions.searchWorkplace.mockResolvedValue({ success: true, data: [{ fbid: "654", value: "Company" }] });
    actions.searchJobTitle.mockResolvedValue({ success: true, data: [{ fbid: "987", value: "Designer" }] });
});

describe("Робота й освіта фанпейджі", () => {
    it("оновлює наявну освіту, передаючи всі актуальні токени", async () => {
        actions.getEducation.mockResolvedValue({ success: true, data: [{ education_experience_id: "old-education" }] });
        const input = options();
        expect((await updateEducationField({ ...input, schoolName: "College" })).success).toBe(true);
        expect(actions.saveEducation).toHaveBeenCalledWith(expect.objectContaining({
            ...tokens, educationExperienceID: "old-education", schoolId: "321", schoolName: "College",
        }));
        expect(actions.addEducation).not.toHaveBeenCalled();
        expect(input.beforeAction).toHaveBeenCalledTimes(3);
    });

    it("додає освіту за відсутності та не підміняє невдалу зміну випадковою", async () => {
        actions.addEducation.mockResolvedValue({ success: false, status: "COLLEGE_NOT_FOUND", error: "Не знайдено" });
        expect(await updateEducationField({ ...options(), schoolName: "Unknown" })).toMatchObject({ success: false, status: "COLLEGE_NOT_FOUND" });
        expect(actions.addEducation).toHaveBeenCalledWith(expect.objectContaining({ schoolName: "Unknown" }));
        expect(actions.fallbackEducation).not.toHaveBeenCalled();
    });

    it("видаляє перший попередній запис роботи лише після успішного створення нового", async () => {
        actions.getWork.mockResolvedValue({ success: true, data: [{ work_experience_id: "old-work" }, { work_experience_id: "other-work" }] });
        expect((await updateWorkField({ ...options(), work: { company: "Company", position: "Designer" } })).success).toBe(true);
        expect(actions.deleteWork).toHaveBeenCalledTimes(1);
        expect(actions.deleteWork).toHaveBeenCalledWith(expect.objectContaining({ workExperienceID: "old-work" }));
        expect(actions.createWork.mock.invocationCallOrder[0]).toBeLessThan(actions.deleteWork.mock.invocationCallOrder[0]);
    });

    it("зберігає попередню роботу при відмові Facebook і не запускає fallback", async () => {
        actions.getWork.mockResolvedValue({ success: true, data: [{ work_experience_id: "old-work" }] });
        actions.createWork.mockResolvedValue({ success: false, status: "GRAPHQL_ERROR" });
        expect((await updateWorkField({ ...options(), work: { company: "Company", position: "Designer" } })).success).toBe(false);
        expect(actions.deleteWork).not.toHaveBeenCalled();
        expect(actions.fallbackWork).not.toHaveBeenCalled();
    });

    it("зупиняється при зміні actor до наступної mutation", async () => {
        const beforeAction = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(Object.assign(new Error("Actor змінився"), { code: "FANPAGE_CHANGED" }));
        await expect(updateEducationField({ ...options(), beforeAction, schoolName: "College" })).rejects.toMatchObject({ code: "FANPAGE_CHANGED" });
        expect(actions.addEducation).not.toHaveBeenCalled();
    });

    it("пропускає порожні поля, зберігаючи попередню поведінку створення комент-акаунтів", async () => {
        expect(await updateWorkField({ ...options(), work: { company: "Company", position: "" } })).toMatchObject({ skipped: true });
        expect(await updateEducationField({ ...options(), schoolName: "" })).toMatchObject({ skipped: true });
        expect(actions.getWork).not.toHaveBeenCalled();
        actions.getWork.mockResolvedValue({ success: true, data: [{ work_experience_id: "old-work" }] });
        expect(await updateWorkField({ ...options(), replaceExisting: false, work: {} })).toMatchObject({ status: "ALREADY_EXISTS" });
        expect(actions.deleteWork).not.toHaveBeenCalled();
    });

    it("формує mutations для actor фанпейджі, коли __user належить основному акаунту", () => {
        const input = { runtimeContext: { av: "200", __user: "100" }, ...tokens, schoolId: "321", schoolName: "College",
            companyId: "654", jobTitleId: "987" };
        for (const variables of [buildEducationSaveVariables(input), buildWorkExperienceSaveVariables(input)]) {
            expect(variables.input.actor_id).toBe("200");
            expect(variables.profileID).toBe("200");
        }
    });
});
