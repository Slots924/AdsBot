import { waitHuman } from "../browser/timing.js";
import handleFuturePostsAudience, {
    matchFuturePostsAudience,
} from "./futurePostsAudience.js";
import inspectVisibleModal from "./inspectVisibleModal.js";
import logModal from "./logModal.js";
import handleReviewAudience, {
    matchReviewAudience,
} from "./reviewAudience.js";


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
    let emptyStreak = 0;
    const deadline = Date.now() + Number(timeout);
    await waitHuman("medium", timingOptions);

    while (Date.now() < deadline) {
        const snapshot = await inspectVisibleModal(page);
        const modal = knownPostPublishModals.find((item) =>
            item.match(snapshot)
        );

        if (modal) {
            logModal(logger, "Піймали модальне вікно", {
                kind: modal.id,
                title: snapshot?.title ?? "",
                ariaLabel: snapshot?.ariaLabel ?? "",
            });
            await modal.handle(page, { timeout, timingOptions, logger });
            handled.push(modal.id);
            if (modal.id === "reviewAudience") {
                logModal(
                    logger,
                    "Аудиторію збережено. Вікно поста має бути відкрите, кнопку «What's on your mind?» більше не тиснемо"
                );
                return { handled };
            }
            emptyStreak = 0;
            continue;
        }

        if (snapshot?.createPostVisible || snapshot?.kind === "createPost") {
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

        logModal(logger, "Невідома модалка", {
            title: snapshot?.title ?? "",
            ariaLabel: snapshot?.ariaLabel ?? "",
        });
        if (handled.length > 0) {
            logModal(
                logger,
                "Після Save лишилось вікно — вважаємо це композер поста, не клікаємо «What's on your mind?» знову"
            );
            return { handled };
        }

        await waitHuman("short", timingOptions);
    }

    throw new Error("Після Post лишилось невідоме модальне вікно");
}
