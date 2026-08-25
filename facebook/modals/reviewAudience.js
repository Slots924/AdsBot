import { waitHuman } from "../browser/timing.js";
import {
    postPublishContinueButtonSelector,
} from "../selectors/postPublishModals.js";
import {
    clickModalButtonByText,
    clickModalSelector,
} from "./clickModalControl.js";
import handleFuturePostsAudience from "./futurePostsAudience.js";
import { classifyPostPublishModal } from "./inspectVisibleModal.js";
import logModal from "./logModal.js";


export function matchReviewAudience(snapshot) {
    return classifyPostPublishModal(snapshot) === "reviewAudience"
        || snapshot?.kind === "reviewAudience";
}


export default async function handleReviewAudience(
    page,
    { timeout, timingOptions, logger } = {}
) {
    logModal(logger, "Шукаємо кнопку Continue", {
        selector: postPublishContinueButtonSelector,
    });
    try {
        await clickModalSelector(
            page,
            postPublishContinueButtonSelector,
            timeout,
            timingOptions,
            "medium"
        );
        logModal(logger, "Знайшли Continue, натиснули");
    } catch (error) {
        logModal(logger, "Селектор Continue не спрацював, шукаємо за текстом", {
            error: error.message,
        });
        await clickModalButtonByText(
            page,
            'div[role="button"]',
            "Continue",
            timeout,
            timingOptions
        );
        logModal(logger, "Знайшли Continue за текстом, натиснули");
    }

    await waitHuman("medium", timingOptions);
    logModal(logger, "Після Continue вибираємо Public і тиснемо Save");
    await handleFuturePostsAudience(page, { timeout, timingOptions, logger });
}
