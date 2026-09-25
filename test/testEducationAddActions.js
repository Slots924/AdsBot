import assert from "node:assert/strict";

import addEducation, {
    addEducationStatuses,
} from "../facebook/api-actions/education/addEducation.js";
import addFallbackEducation, {
    addFallbackEducationStatuses,
} from "../facebook/api-actions/education/addFallbackEducation.js";


const commonPayload = {
    av: "100",
    __user: "100",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "22000",
    lsd: "lsd-token",
    __comet_req: "15",
};


// Створює page-заглушку з наперед визначеними відповідями Facebook.
function createPage(responses) {
    return {
        async evaluate() {
            const response = responses.shift();
            assert(response, "Отримано неочікуваний запит Facebook");
            return response;
        },
    };
}


const successResponse = (body) => ({
    ok: true,
    statusCode: 200,
    body: JSON.stringify(body),
});


const addResult = await addEducation({
    page: createPage([
        successResponse({
            data: {
                typeahead: {
                    title: "Oxford Brookes University",
                    fbid: "12345",
                    value: "Oxford Brookes University",
                },
            },
        }),
        successResponse({ data: { saved: true } }),
    ]),
    commonPayload,
    collectionToken: "collection-token",
    sectionToken: "section-token",
    schoolName: "Oxford Brookes University",
});

assert.equal(addResult.success, true);
assert.equal(addResult.status, addEducationStatuses.ADDED);
assert.deepEqual(addResult.school, {
    id: "12345",
    name: "Oxford Brookes University",
});
assert.equal(addResult.stage, "CREATE");

const notFoundResult = await addEducation({
    page: createPage([successResponse({ data: {} })]),
    commonPayload,
    collectionToken: "collection-token",
    sectionToken: "section-token",
    schoolName: "Unknown College",
});

assert.equal(notFoundResult.success, false);
assert.equal(notFoundResult.status, addEducationStatuses.COLLEGE_NOT_FOUND);
assert.equal(notFoundResult.stage, "SEARCH");

const fallbackResult = await addFallbackEducation({
    page: createPage([successResponse({ data: { saved: true } })]),
    commonPayload,
    collectionToken: "collection-token",
    sectionToken: "section-token",
});

assert.equal(fallbackResult.success, true);
assert.equal(fallbackResult.status, addFallbackEducationStatuses.ADDED);
assert.deepEqual(fallbackResult.school, {
    id: "10593065111",
    name: "Harvard University",
});
assert.equal(fallbackResult.stage, "CREATE");

console.log("Перевірка окремих Education add actions пройшла успішно");
