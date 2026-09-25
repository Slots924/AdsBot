import { getProfilePhotoRejectReason }
    from "../../../services/accounts/photoSets.js";
import loadImageFromPath
    from "../../../services/images/loadImageFromPath.js";
import uploadProfilePhoto from "./uploadProfilePhoto.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const uploadEndpoint = "/profile/cover/comet_upload/";
const setCoverFriendlyName = "ProfileCometCoverPhotoUpdateMutation";
const setCoverDocId = "26648951184714383";


export const changeCoverPhotoStatuses = Object.freeze({
    CHANGED: "CHANGED",
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_IMAGE: "INVALID_IMAGE",
    UPLOAD_TIMEOUT: "UPLOAD_TIMEOUT",
    UPLOAD_HTTP_ERROR: "UPLOAD_HTTP_ERROR",
    UPLOAD_PARSE_ERROR: "UPLOAD_PARSE_ERROR",
    UPLOAD_INVALID_RESPONSE: "UPLOAD_INVALID_RESPONSE",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує фокус обкладинки у відносних координатах Facebook.
function normalizeFocus(focus) {
    if (focus === undefined || focus === null) return { x: 0.5, y: 0.5 };

    const x = Number(focus.x);
    const y = Number(focus.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return null;
    }

    return { x, y };
}


// Дістає корисні дані обкладинки з mutation-відповіді, якщо Facebook їх повернув.
function extractCoverPhotoData(data) {
    const profile = data?.data?.user_update_cover_photo?.user ?? null;
    const coverPhoto = profile?.cover_photo ?? profile?.coverPhoto ?? null;
    const image = coverPhoto?.photo?.image ?? coverPhoto?.photo ?? null;

    return {
        coverPhotoId: coverPhoto?.photo?.id ?? coverPhoto?.id ?? null,
        coverPhotoUrl: image?.uri ?? image?.url ?? null,
        focus: coverPhoto?.focus ?? null,
    };
}


// Завантажує локальне зображення та встановлює його обкладинкою поточного Facebook-профілю.
export default async function changeCoverPhoto({
    page,
    commonPayload,
    imagePath,
    attributionId = null,
    focus,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedFocus = normalizeFocus(focus);
    if (validationError || missingRequestField || !String(imagePath ?? "").trim() || !normalizedFocus) {
        return createResult(false, changeCoverPhotoStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : (!normalizedFocus
                        ? "focus має містити координати x та y від 0 до 1"
                        : "Потрібен шлях до файлу cover")),
        });
    }

    const imageRejectReason = await getProfilePhotoRejectReason(imagePath, "cover");
    if (imageRejectReason) {
        return createResult(false, changeCoverPhotoStatuses.INVALID_IMAGE, null, {
            error: imageRejectReason,
        });
    }

    try {
        const image = await loadImageFromPath(imagePath);
        const profileId = String(commonPayload.__user);
        const normalizedTimeout = normalizeTimeout(timeout);
        const uploadResponse = await uploadProfilePhoto(page, {
            endpoint: uploadEndpoint,
            image,
            profileId,
            commonPayload,
            timeout: normalizedTimeout,
        });

        if (uploadResponse.requestError === "TIMEOUT") {
            return createResult(false, changeCoverPhotoStatuses.UPLOAD_TIMEOUT, null, {
                stage: "UPLOAD",
            });
        }
        if (uploadResponse.requestError) {
            return createResult(false, changeCoverPhotoStatuses.REQUEST_FAILED, null, {
                stage: "UPLOAD",
                error: uploadResponse.requestError,
            });
        }
        if (!uploadResponse.ok) {
            return createResult(false, changeCoverPhotoStatuses.UPLOAD_HTTP_ERROR, null, {
                stage: "UPLOAD",
                httpStatus: uploadResponse.statusCode,
            });
        }

        let uploadData;
        try {
            uploadData = parseFacebookJson(uploadResponse.body);
        } catch (error) {
            return createResult(false, changeCoverPhotoStatuses.UPLOAD_PARSE_ERROR, null, {
                stage: "UPLOAD",
                error: String(error?.message ?? error),
            });
        }

        const uploadedPhotoId = uploadData?.payload?.fbid;
        if (!uploadedPhotoId) {
            return createResult(
                false,
                changeCoverPhotoStatuses.UPLOAD_INVALID_RESPONSE,
                uploadData,
                {
                    stage: "UPLOAD",
                    error: "Facebook не повернув ID завантаженої обкладинки",
                    httpStatus: uploadResponse.statusCode,
                }
            );
        }

        const input = {
            cover_photo_id: String(uploadedPhotoId),
            focus: normalizedFocus,
            target_user_id: profileId,
            actor_id: profileId,
            client_mutation_id: "1",
        };
        if (typeof attributionId === "string" && attributionId.trim()) {
            input.attribution_id_v2 = attributionId.trim();
        }

        const body = buildMutationBody(commonPayload, {
            friendlyName: setCoverFriendlyName,
            docId: setCoverDocId,
            variables: {
                input,
                scale: 1,
                contextualProfileContext: null,
            },
            extraParameters: {
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const setResponse = await postFacebookForm(page, {
            body,
            friendlyName: setCoverFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (setResponse.requestError === "TIMEOUT") {
            return createResult(false, changeCoverPhotoStatuses.REQUEST_TIMEOUT, null, {
                stage: "SET",
            });
        }
        if (setResponse.requestError) {
            return createResult(false, changeCoverPhotoStatuses.REQUEST_FAILED, null, {
                stage: "SET",
                error: setResponse.requestError,
            });
        }
        if (!setResponse.ok) {
            return createResult(false, changeCoverPhotoStatuses.HTTP_ERROR, null, {
                stage: "SET",
                httpStatus: setResponse.statusCode,
            });
        }

        let setData;
        try {
            setData = parseFacebookJson(setResponse.body);
        } catch (error) {
            return createResult(false, changeCoverPhotoStatuses.PARSE_ERROR, null, {
                stage: "SET",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(setData)) {
            return createResult(false, changeCoverPhotoStatuses.GRAPHQL_ERROR, setData, {
                stage: "SET",
                httpStatus: setResponse.statusCode,
            });
        }

        return createResult(true, changeCoverPhotoStatuses.CHANGED, {
            uploadedPhotoId: String(uploadedPhotoId),
            uploadedImageUrl: uploadData?.payload?.imageURI ?? null,
            ...extractCoverPhotoData(setData),
        }, {
            httpStatus: setResponse.statusCode,
        });
    } catch (error) {
        return createResult(false, changeCoverPhotoStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
