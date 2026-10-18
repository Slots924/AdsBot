import getNameChangeStatus
    from "../../api-actions/accounts/getNameChangeStatus.js";
import validateFacebookName
    from "../../api-actions/accounts/validateFacebookName.js";
import changeFacebookName
    from "../../api-actions/accounts/changeFacebookName.js";


const defaultTimeoutMs = 30000;


export const changeFacebookNameWorkflowStatuses = Object.freeze({
    NAME_CHANGED: "NAME_CHANGED",
    NAME_UNCHANGED: "NAME_UNCHANGED",
    NAME_CHANGE_NOT_AVAILABLE: "NAME_CHANGE_NOT_AVAILABLE",
    NAME_CHANGE_AVAILABILITY_UNKNOWN: "NAME_CHANGE_AVAILABILITY_UNKNOWN",
    NAME_INVALID: "NAME_INVALID",
    NAME_VALIDATION_UNKNOWN: "NAME_VALIDATION_UNKNOWN",
    RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
    NAME_CHANGE_STATUS_FAILED: "NAME_CHANGE_STATUS_FAILED",
    NAME_VALIDATION_FAILED: "NAME_VALIDATION_FAILED",
    NAME_CHANGE_FAILED: "NAME_CHANGE_FAILED",
    INVALID_INPUT: "INVALID_INPUT",
    ERROR: "ERROR",
});


function createResult(success, status, data = null, extra = {}) {
    return {
        success,
        status,
        data,
        ...extra,
    };
}


function normalizeRequiredNamePart(value) {
    return String(value ?? "").trim();
}


function normalizeMiddleName(value) {
    return String(value ?? "").trim();
}


function normalizeNameForComparison(value) {
    return String(value ?? "")
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}


function isCurrentNameRequestedName(currentName, requestedName) {
    if (!currentName) return false;

    return normalizeNameForComparison(currentName.firstName)
        === normalizeNameForComparison(requestedName.firstName)
        && normalizeNameForComparison(currentName.middleName)
        === normalizeNameForComparison(requestedName.middleName)
        && normalizeNameForComparison(currentName.lastName)
        === normalizeNameForComparison(requestedName.lastName);
}


// Послідовно перевіряє можливість, валідність і змінює ім'я поточного Facebook-профілю.
export default async function changeFacebookNameWorkflow({
    page,
    firstName,
    middleName = "",
    lastName,
    timeout = defaultTimeoutMs,
}) {
    if (!page || typeof page.goto !== "function") {
        return createResult(false, changeFacebookNameWorkflowStatuses.INVALID_INPUT, null, {
            error: "Не передано Puppeteer page",
        });
    }

    const requestedName = {
        firstName: normalizeRequiredNamePart(firstName),
        middleName: normalizeMiddleName(middleName),
        lastName: normalizeRequiredNamePart(lastName),
    };
    if (!requestedName.firstName || !requestedName.lastName) {
        return createResult(false, changeFacebookNameWorkflowStatuses.INVALID_INPUT, null, {
            error: "Потрібні непорожні firstName і lastName для зміни імені",
        });
    }

    try {
        const availabilityResult = await getNameChangeStatus({
            page,
            timeout,
        });
        if (!availabilityResult.success) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_CHANGE_STATUS_FAILED, {
                requestedName,
            }, {
                stage: "GET_NAME_CHANGE_STATUS",
                actionStatus: availabilityResult.status,
                error: availabilityResult.error ?? null,
            });
        }

        const availability = availabilityResult.data;
        if (isCurrentNameRequestedName(availability.currentName, requestedName)) {
            return createResult(true, changeFacebookNameWorkflowStatuses.NAME_UNCHANGED, {
                userId: availability.userId,
                requestedName,
                currentName: availability.currentName,
            });
        }

        if (
            availability.canChangeName === null
            || availability.cooldownStatus === null
        ) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_CHANGE_AVAILABILITY_UNKNOWN, {
                userId: availability.userId,
                requestedName,
                canChangeName: availability.canChangeName,
                cooldownStatus: availability.cooldownStatus,
            });
        }
        if (availability.canChangeName !== true || availability.cooldownStatus !== false) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_CHANGE_NOT_AVAILABLE, {
                userId: availability.userId,
                requestedName,
                canChangeName: availability.canChangeName,
                cooldownStatus: availability.cooldownStatus,
                canRevertName: availability.canRevertName,
            });
        }

        const validationResult = await validateFacebookName({
            page,
            ...requestedName,
            timeout,
        });
        if (!validationResult.success) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_VALIDATION_FAILED, {
                userId: availability.userId,
                requestedName,
            }, {
                stage: "VALIDATE_NAME",
                actionStatus: validationResult.status,
                error: validationResult.error ?? null,
            });
        }
        if (validationResult.data.isValid === null) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_VALIDATION_UNKNOWN, {
                userId: availability.userId,
                requestedName,
                errorMessage: validationResult.data.errorMessage,
            });
        }
        if (validationResult.data.isValid === false) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_INVALID, {
                userId: availability.userId,
                requestedName,
                errorMessage: validationResult.data.errorMessage,
            });
        }

        const changeResult = await changeFacebookName({
            page,
            ...requestedName,
            timeout,
        });
        if (!changeResult.success) {
            return createResult(false, changeFacebookNameWorkflowStatuses.NAME_CHANGE_FAILED, {
                userId: availability.userId,
                requestedName,
                mutation: changeResult.data ?? null,
            }, {
                stage: "CHANGE_NAME",
                actionStatus: changeResult.status,
                error: changeResult.error ?? changeResult.data?.error ?? null,
            });
        }

        return createResult(true, changeFacebookNameWorkflowStatuses.NAME_CHANGED, {
            ...changeResult.data,
            validation: {
                isValid: validationResult.data.isValid,
                errorMessage: validationResult.data.errorMessage,
            },
        });
    } catch (error) {
        return createResult(false, changeFacebookNameWorkflowStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
