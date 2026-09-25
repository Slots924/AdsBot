const uploadPayloadFields = [
    "av",
    "__aaid",
    "__user",
    "__a",
    "__req",
    "__hs",
    "dpr",
    "__ccg",
    "__rev",
    "__s",
    "__hsi",
    "__dyn",
    "__csr",
    "__hsdp",
    "__hblp",
    "__sjsp",
    "__comet_req",
    "fb_dtsg",
    "jazoest",
    "lsd",
    "__spin_r",
    "__spin_b",
    "__spin_t",
    "__crn",
];


// Формує актуальні параметри сесії для multipart-завантаження фото.
function buildUploadParameters(commonPayload, profileId, extraParameters) {
    const parameters = {
        profile_id: String(profileId),
        ...extraParameters,
    };

    uploadPayloadFields.forEach((field) => {
        const value = commonPayload[field];
        if (value !== undefined && value !== null) {
            parameters[field] = String(value);
        }
    });

    return parameters;
}


// Завантажує зображення через поточну авторизовану Facebook-сесію браузера.
export default async function uploadProfilePhoto(page, {
    endpoint,
    image,
    profileId,
    commonPayload,
    timeout,
    queryParameters = {},
    formParameters = {},
    fileFieldName = "file",
}) {
    return page.evaluate(
        async ({
            imageBase64,
            imageName,
            imageType,
            currentProfileId,
            parameters,
            formFields,
            requestEndpoint,
            uploadFileFieldName,
            timeoutMs,
        }) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const binary = atob(imageBase64);
                const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
                const imageFile = new File([bytes], imageName, { type: imageType });
                const form = new FormData();

                Object.entries(formFields).forEach(([field, value]) => {
                    if (value !== undefined && value !== null) {
                        form.append(field, String(value));
                    }
                });
                form.append(uploadFileFieldName, imageFile, imageName);

                const response = await fetch(
                    `${requestEndpoint}?${new URLSearchParams(parameters).toString()}`,
                    {
                        method: "POST",
                        body: form,
                        credentials: "include",
                        signal: controller.signal,
                    }
                );

                return {
                    ok: response.ok,
                    statusCode: response.status,
                    body: await response.text(),
                };
            } catch (error) {
                return {
                    requestError: error?.name === "AbortError"
                        ? "TIMEOUT"
                        : String(error?.message ?? error),
                };
            } finally {
                clearTimeout(timeoutId);
            }
        },
        {
            imageBase64: image.buffer.toString("base64"),
            imageName: image.filename,
            imageType: image.contentType,
            currentProfileId: String(profileId),
            parameters: buildUploadParameters(commonPayload, profileId, queryParameters),
            formFields: {
                profile_id: String(profileId),
                av: String(profileId),
                ...formParameters,
            },
            requestEndpoint: endpoint,
            uploadFileFieldName: fileFieldName,
            timeoutMs: timeout,
        }
    );
}
