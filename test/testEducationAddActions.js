import assert from "node:assert/strict";

import addEducation, {
    addEducationStatuses,
} from "../facebook/api-actions/education/addEducation.js";
import addFallbackEducation, {
    addFallbackEducationStatuses,
} from "../facebook/api-actions/education/addFallbackEducation.js";
import searchCollege, {
    searchCollegeStatuses,
} from "../facebook/api-actions/education/searchCollege.js";
import searchWorkplace, {
    searchWorkplaceStatuses,
} from "../facebook/api-actions/workplace/searchWorkplace.js";


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

const collegeCustomOptionResult = await searchCollege({
    page: createPage([successResponse({
        data: {
            typeahead: {
                title: "Add \"Unknown College\"",
                fbid: "-1",
                value: "Unknown College",
            },
        },
    })]),
    commonPayload,
    query: "Unknown College",
});

assert.equal(collegeCustomOptionResult.success, true);
assert.equal(
    collegeCustomOptionResult.status,
    searchCollegeStatuses.COLLEGES_NOT_FOUND
);
assert.deepEqual(collegeCustomOptionResult.data, []);

const workplaceResult = await searchWorkplace({
    page: createPage([successResponse({
        data: {
            viewer: {
                profile_directory_typeahead_suggestions: [
                    {
                        title: "Example Company",
                        fbid: "67890",
                        value: "Example Company",
                    },
                    {
                        title: "Add \"Example Company\"",
                        fbid: "-1",
                        value: "Example Company",
                    },
                ],
            },
        },
    })]),
    commonPayload,
    query: "Example Company",
});

assert.equal(workplaceResult.success, true);
assert.equal(workplaceResult.status, searchWorkplaceStatuses.COMPANIES_FOUND);
assert.deepEqual(workplaceResult.data, [{
    title: "Example Company",
    fbid: "67890",
    value: "Example Company",
}]);

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
