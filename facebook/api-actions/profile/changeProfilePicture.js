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


const uploadEndpoint = "/profile/picture/upload/";
const uploadPhotoSource = "57";
const setPictureFriendlyName = "ProfileCometProfilePictureSetMutation";
const setPictureDocId = "27326177573748994";

export const changeProfilePictureStatuses = Object.freeze({
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


// Формує нормалізований центрований квадратний crop для завантаженого фото.
function createCenteredSquareCrop(width, height) {
    const side = Math.min(width, height);

    return {
        x: (width - side) / 2 / width,
        y: (height - side) / 2 / height,
        width: side / width,
        height: side / height,
    };
}


// Дістає корисні дані фото з відповіді mutation, якщо Facebook їх повернув.
function extractProfilePhotoData(data) {
    const profile = data?.data?.profile_picture_set?.profile;
    const profilePhoto = profile?.profilePhoto ?? profile?.profile_photo ?? null;

    return {
        profilePhotoId: profilePhoto?.id ?? null,
        profilePhotoUrl: profilePhoto?.url
            ?? profile?.profilePicLarge?.uri
            ?? profile?.profilePicMedium?.uri
            ?? profile?.profilePicSmall?.uri
            ?? null,
    };
}


// Завантажує локальне фото та встановлює його аватаркою поточного Facebook-профілю.
export default async function changeProfilePicture({
    page,
    commonPayload,
    imagePath,
    attributionId = null,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    if (validationError || missingRequestField || !String(imagePath ?? "").trim()) {
        return createResult(false, changeProfilePictureStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібен шлях до файлу avatar"),
        });
    }

    const imageRejectReason = await getProfilePhotoRejectReason(imagePath, "avatar");
    if (imageRejectReason) {
        return createResult(false, changeProfilePictureStatuses.INVALID_IMAGE, null, {
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
            queryParameters: {
                photo_source: uploadPhotoSource,
            },
            formParameters: {
                photo_source: uploadPhotoSource,
            },
        });

        if (uploadResponse.requestError === "TIMEOUT") {
            return createResult(false, changeProfilePictureStatuses.UPLOAD_TIMEOUT, null, {
                stage: "UPLOAD",
            });
        }
        if (uploadResponse.requestError) {
            return createResult(false, changeProfilePictureStatuses.REQUEST_FAILED, null, {
                stage: "UPLOAD",
                error: uploadResponse.requestError,
            });
        }
        if (!uploadResponse.ok) {
            return createResult(false, changeProfilePictureStatuses.UPLOAD_HTTP_ERROR, null, {
                stage: "UPLOAD",
                httpStatus: uploadResponse.statusCode,
            });
        }

        let uploadData;
        try {
            uploadData = parseFacebookJson(uploadResponse.body);
        } catch (error) {
            return createResult(false, changeProfilePictureStatuses.UPLOAD_PARSE_ERROR, null, {
                stage: "UPLOAD",
                error: String(error?.message ?? error),
            });
        }

        const uploadedPhotoId = uploadData?.payload?.fbid;
        const imageWidth = Number(uploadData?.payload?.imageWidth);
        const imageHeight = Number(uploadData?.payload?.imageHeight);
        if (!uploadedPhotoId || !imageWidth || !imageHeight) {
            return createResult(
                false,
                changeProfilePictureStatuses.UPLOAD_INVALID_RESPONSE,
                uploadData,
                {
                    stage: "UPLOAD",
                    error: "Facebook не повернув ID або розміри завантаженого фото",
                    httpStatus: uploadResponse.statusCode,
                }
            );
        }

        const input = {
            caption: "",
            existing_photo_id: String(uploadedPhotoId),
            expiration_time: null,
            profile_id: profileId,
            profile_pic_method: "EXISTING",
            profile_pic_source: "TIMELINE",
            scaled_crop_rect: createCenteredSquareCrop(imageWidth, imageHeight),
            skip_cropping: true,
            actor_id: profileId,
            client_mutation_id: "1",
        };
        if (typeof attributionId === "string" && attributionId.trim()) {
            input.attribution_id_v2 = attributionId.trim();
        }

        const body = buildMutationBody(commonPayload, {
            friendlyName: setPictureFriendlyName,
            docId: setPictureDocId,
            variables: {
                input,
                isPage: false,
                isProfile: true,
                scale: 1,
                __relay_internal__pv__ProfileGeminiIsCoinFlipEnabledrelayprovider: false,
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
            friendlyName: setPictureFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (setResponse.requestError === "TIMEOUT") {
            return createResult(false, changeProfilePictureStatuses.REQUEST_TIMEOUT, null, {
                stage: "SET",
            });
        }
        if (setResponse.requestError) {
            return createResult(false, changeProfilePictureStatuses.REQUEST_FAILED, null, {
                stage: "SET",
                error: setResponse.requestError,
            });
        }
        if (!setResponse.ok) {
            return createResult(false, changeProfilePictureStatuses.HTTP_ERROR, null, {
                stage: "SET",
                httpStatus: setResponse.statusCode,
            });
        }

        let setData;
        try {
            setData = parseFacebookJson(setResponse.body);
        } catch (error) {
            return createResult(false, changeProfilePictureStatuses.PARSE_ERROR, null, {
                stage: "SET",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(setData)) {
            return createResult(false, changeProfilePictureStatuses.GRAPHQL_ERROR, setData, {
                stage: "SET",
                httpStatus: setResponse.statusCode,
            });
        }

        return createResult(true, changeProfilePictureStatuses.CHANGED, {
            uploadedPhotoId: String(uploadedPhotoId),
            uploadedImageUrl: uploadData.payload.imageURI ?? null,
            uploadedImageWidth: imageWidth,
            uploadedImageHeight: imageHeight,
            ...extractProfilePhotoData(setData),
        }, {
            httpStatus: setResponse.statusCode,
        });
    } catch (error) {
        return createResult(false, changeProfilePictureStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
