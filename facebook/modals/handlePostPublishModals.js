import { waitHuman } from "../browser/timing.js";
import handleFuturePostsAudience, {
    matchFuturePostsAudience,
} from "./futurePostsAudience.js";
import inspectVisibleModal from "./inspectVisibleModal.js";
import logModal from "./logModal.js";
import handleReviewAudience, {
    matchReviewAudience,
} from "./reviewAudience.js";
import { getBrowserTrace } from "../../services/logging/browserTraceContext.js";


const knownPostPublishModals = [
    {
        id: "reviewAudience",
        match: matchReviewAudience,
        handle: handleReviewAudience,
    },
    {
        id: "futurePostsAudience",
        match: matchFuturePostsAudience,
        handle: handleFuturePostsAudience,
    },
];


export default async function handlePostPublishModals(
    page,
    {
        timeout = 90000,
        timingOptions = {},
        logger,
    } = {}
) {
    const handled = [];
    const trace = getBrowserTrace(page);
    let unknownRecorded = false;
    let emptyStreak = 0;
    const deadline = Date.now() + Number(timeout);

    while (Date.now() < deadline) {
        const snapshot = await inspectVisibleModal(page);
        const modal = knownPostPublishModals.find((item) =>
            item.match(snapshot)
        );

        if (modal) {
            await trace?.event("modal.detected", { point: modal.id });
            await trace?.observe(page, { point: `modal.${modal.id}` });
            logModal(logger, "Піймали модальне вікно", {
                kind: modal.id,
                title: snapshot?.title ?? "",
                ariaLabel: snapshot?.ariaLabel ?? "",
            });
            await modal.handle(page, { timeout, timingOptions, logger });
            handled.push(modal.id);
            emptyStreak = 0;
            continue;
        }

        if ((!snapshot?.found && snapshot?.createPostVisible) || snapshot?.kind === "createPost") {
            logModal(logger, "Вікно Create post готове, постимо далі");
            return { handled };
        }

        if (!snapshot?.found) {
            emptyStreak += 1;
            if (handled.length === 0 || emptyStreak >= 2) {
                return { handled };
            }
            await waitHuman("short", timingOptions);
            continue;
        }

        if (!unknownRecorded) {
            logModal(logger, "Невідома модалка", {
                title: snapshot?.title ?? "",
                ariaLabel: snapshot?.ariaLabel ?? "",
            });
            unknownRecorded = true;
            await trace?.failure(page, { point: "modal.unknown",
                error: { code: "FACEBOOK_UNKNOWN_POST_MODAL" } });
        }

        await waitHuman("short", timingOptions);
    }

    throw Object.assign(new Error("Після Post лишилось невідоме модальне вікно"), {
        code: "FACEBOOK_UNKNOWN_POST_MODAL",
    });
}
