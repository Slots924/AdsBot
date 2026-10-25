import getSwitchableFacebookProfiles from "../../../api-actions/pages/getSwitchableFacebookProfiles.js";
import HttpProfileReadContext from "../../HttpProfileReadContext.js";
import { actionError, actionFailure } from "../../graphql/errors.js";

// Об'єднує доступні профілі з поточним actor та прибирає власника сесії й дублікати.
export default async function getFanPages(client, { signal } = {}) {
    try {
        return await client.run(async () => {
            const identity = await client.readActorContext({ signal });
            const context = new HttpProfileReadContext(client, identity, { signal });
            const result = await getSwitchableFacebookProfiles({ page: context });
            if (!result.success) {
                if (context.failure) throw context.failure;
                throw actionError("Facebook не повернув список профілів для перемикання", "FACEBOOK_PROFILE_LIST_INVALID", {
                    httpStatus: result.httpStatus ?? null,
                });
            }
            if (result.currentActor?.id !== identity.actorId) {
                throw actionError("Actor змінився під час читання списку профілів", "FACEBOOK_SESSION_MISMATCH");
            }
            const pages = new Map();
            for (const profile of [...result.data, result.currentActor]) {
                if (!/^[1-9]\d*$/.test(profile.id) || profile.id === identity.accountId) continue;
                const previous = pages.get(profile.id);
                pages.set(profile.id, {
                    additionalProfileId: profile.id,
                    name: profile.name ?? previous?.name ?? null,
                    photoUrl: profile.photoUrl ?? previous?.photoUrl ?? null,
                });
            }
            return {
                success: true, outcome: "FAN_PAGES_LOADED", code: null, message: "Список фанпейджів отримано",
                accountId: identity.accountId, currentActorId: identity.actorId,
                pages: [...pages.values()], count: pages.size,
            };
        });
    } catch (error) {
        return actionFailure(error);
    }
}
