import { waitHuman } from "../browser/timing.js";
import {
    postPublishAudienceSaveButtonSelector,
    postPublishModalDialogSelector,
    postPublishPublicLabelSelector,
} from "../selectors/postPublishModals.js";
import {
    clickDialogSpanParent,
    clickModalButtonByText,
    clickModalSelector,
} from "./clickModalControl.js";
import { classifyPostPublishModal } from "./inspectVisibleModal.js";
import logModal from "./logModal.js";


export function matchFuturePostsAudience(snapshot) {
    return classifyPostPublishModal(snapshot) === "futurePostsAudience"
        || snapshot?.kind === "futurePostsAudience";
}


export default async function handleFuturePostsAudience(
    page,
    { timeout, timingOptions, logger } = {}
) {
    logModal(logger, "Шукаємо пункт Public (span → parent)", {
        dialog: postPublishModalDialogSelector,
        span: postPublishPublicLabelSelector,
        text: "Public",
    });
    await clickDialogSpanParent(page, {
        dialogSelector: postPublishModalDialogSelector,
        spanSelector: postPublishPublicLabelSelector,
        expectedText: "Public",
        timeout,
        timingOptions,
    });
    logModal(logger, "Знайшли Public, натиснули ЛКМ по parent");

    await waitHuman("medium", timingOptions);

    logModal(logger, "Шукаємо кнопку Save", {
        selector: postPublishAudienceSaveButtonSelector,
    });
    try {
        await clickModalSelector(
            page,
            postPublishAudienceSaveButtonSelector,
            timeout,
            timingOptions,
            "medium"
        );
        logModal(logger, "Знайшли Save, натиснули ЛКМ");
    } catch (error) {
        logModal(logger, "Селектор Save не спрацював, шукаємо за текстом", {
            error: error.message,
        });
        await clickModalButtonByText(
            page,
            'div[role="button"]',
            "Save",
            timeout,
            timingOptions
        );
        logModal(logger, "Знайшли Save за текстом, натиснули ЛКМ");
    }

    await waitHuman("medium", timingOptions);
}
