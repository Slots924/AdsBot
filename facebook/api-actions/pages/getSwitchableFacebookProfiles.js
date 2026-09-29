import {
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
} from "../education/common.js";


const profileListFriendlyName = "CometProfileSwitcherListQuery";
const profileListDocId = "25679861721687752";


export const getSwitchableFacebookProfilesStatuses = Object.freeze({
    PROFILES_FETCHED: "PROFILES_FETCHED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_FAILED: "REQUEST_FAILED",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    RESPONSE_STRUCTURE_INVALID: "RESPONSE_STRUCTURE_INVALID",
    ERROR: "ERROR",
});


// Повертає additional profiles, доступні для CometProfileSwitchMutation.
export default async function getSwitchableFacebookProfiles({
    page,
    commonPayload,
    timeout,
}) {
    const requiredFields = ["av", "__user", "__a", "fb_dtsg", "lsd"];
    const missingField = requiredFields.find((field) => (
        commonPayload?.[field] === undefined || commonPayload[field] === null
    ));
    if (!page || typeof page.evaluate !== "function" || !commonPayload || missingField) {
        return createResult(false, getSwitchableFacebookProfilesStatuses.INVALID_INPUT, null, {
            error: !page || typeof page.evaluate !== "function"
                ? "Не передано Puppeteer page"
                : (missingField
                    ? `У commonPayload відсутнє поле ${missingField}`
                    : "Не передано commonPayload"),
        });
    }

    try {
        const scale = await page.evaluate(() => window.devicePixelRatio || 1);
        const body = new URLSearchParams({
            av: String(commonPayload.av),
            __user: String(commonPayload.__user),
            __a: String(commonPayload.__a),
            fb_dtsg: String(commonPayload.fb_dtsg),
            lsd: String(commonPayload.lsd),
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: profileListFriendlyName,
            server_timestamps: "true",
            variables: JSON.stringify({
                enable_lar_eligibility_check: true,
                scale: Number(scale) || 1,
            }),
            doc_id: profileListDocId,
        }).toString();
        const response = await postFacebookForm(page, {
            body,
            friendlyName: profileListFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });
        if (response.requestError === "TIMEOUT") {
            return createResult(false, getSwitchableFacebookProfilesStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, getSwitchableFacebookProfilesStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, getSwitchableFacebookProfilesStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, getSwitchableFacebookProfilesStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, getSwitchableFacebookProfilesStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }
        const actor = data?.data?.viewer?.actor;
        const nodes = actor?.profile_switcher_eligible_profiles?.nodes;
        if (!Array.isArray(nodes)) {
            return createResult(false, getSwitchableFacebookProfilesStatuses.RESPONSE_STRUCTURE_INVALID, data, {
                error: "Facebook не повернув список профілів для перемикання",
                httpStatus: response.statusCode,
            });
        }
        const profiles = nodes.map((node) => {
            const profile = node?.profile;
            if (!profile?.id) return null;
            return {
                id: String(profile.id),
                name: profile.name == null ? null : String(profile.name),
                photoUrl: profile.profile_picture?.uri ?? null,
                photoWidth: profile.profile_picture?.width ?? null,
                photoHeight: profile.profile_picture?.height ?? null,
                photoScale: profile.profile_picture?.scale ?? null,
                isProfilePlus: profile.is_profile_plus ?? null,
                unseenUpdateCount: profile.unseen_update_count ?? null,
                canLandOnProdash: profile.if_can_land_on_prodash_after_profile_switch ?? null,
            };
        }).filter(Boolean);
        return createResult(true, getSwitchableFacebookProfilesStatuses.PROFILES_FETCHED, profiles, {
            actorId: actor?.id == null ? null : String(actor.id),
            count: profiles.length,
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, getSwitchableFacebookProfilesStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
