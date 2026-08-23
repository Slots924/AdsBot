import assert from "node:assert/strict";

import changeFacebookPersonalProfilePostDate, {
    facebookPersonalProfilePostDateStatuses,
    parseFacebookPersonalProfilePostDate,
} from "../facebook/actions/changeFacebookPersonalProfilePostDate.js";
import publishFacebookPersonalProfileMediaPostsWithDates, {
    facebookPersonalProfilePostsWithDatesStatuses,
} from "../facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js";
import isPostAvailable from "../facebook/post/checks/isPostAvailable.js";


assert.deepEqual(
    parseFacebookPersonalProfilePostDate("04/22/2020"),
    {
        year: 2020,
        month: 4,
        day: 22,
        isoDate: "2020-04-22",
        inputDate: "04/22/2020",
    }
);
assert.equal(
    parseFacebookPersonalProfilePostDate("Apr 22, 2020")?.isoDate,
    "2020-04-22"
);
assert.equal(
    parseFacebookPersonalProfilePostDate("April 22, 2020")?.inputDate,
    "04/22/2020"
);
assert.equal(
    parseFacebookPersonalProfilePostDate("2020-04-22")?.isoDate,
    "2020-04-22"
);
assert.equal(parseFacebookPersonalProfilePostDate("02/30/2020"), null);

const logEvents = [];
const logger = {
    info(message, fields) {
        logEvents.push({ level: "info", message, fields });
    },
    error(message, fields) {
        logEvents.push({ level: "error", message, fields });
    },
};
const availablePage = {
    async evaluate() {
        return {
            available: true,
            dialogFound: true,
            dialogName: "Adi Chandra's Post",
            unavailableText: null,
        };
    },
};
assert.equal(await isPostAvailable(availablePage, { logger }), true);
assert.ok(logEvents.some(({ message }) =>
    message.includes("Модальне вікно доступного поста знайдено")
));

const unavailablePage = {
    async evaluate() {
        return {
            available: false,
            dialogFound: true,
            dialogName: "Adi Chandra's Post",
            unavailableText: "This content isn't available",
        };
    },
};
assert.equal(await isPostAvailable(unavailablePage, { logger }), false);

const invalidDateResult = await changeFacebookPersonalProfilePostDate(null, {
    targetDate: "not-a-date",
    logger,
});
assert.equal(invalidDateResult.success, false);
assert.equal(
    invalidDateResult.status,
    facebookPersonalProfilePostDateStatuses.INVALID_INPUT
);

const invalidBatchResult = await publishFacebookPersonalProfileMediaPostsWithDates(
    null,
    {
        posts: [],
        logger,
    }
);
assert.equal(invalidBatchResult.success, false);
assert.equal(
    invalidBatchResult.status,
    facebookPersonalProfilePostsWithDatesStatuses.INVALID_INPUT
);
assert.equal(invalidBatchResult.datePhaseStarted, false);

console.log("Facebook personal profile post date tests passed");
