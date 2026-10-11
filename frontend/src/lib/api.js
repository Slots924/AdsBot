export async function unwrap(responsePromise) {
    const response = await responsePromise;

    if (!response?.ok) {
        const error = new Error(
            response?.error?.message || "Backend повернув помилку"
        );
        Object.assign(error, response?.error ?? {});
        throw error;
    }

    return response.data;
}


export function errorDetails(error) {
    return {
        title: error?.graphUserTitle || "Помилка",
        message: error?.message || "Невідома помилка",
        code: error?.code ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
        graphUserTitle: error?.graphUserTitle ?? null,
        graphUserMessage: error?.graphUserMessage ?? null,
        httpStatus: error?.httpStatus ?? null,
        graphType: error?.graphType ?? null,
        isTransient: error?.isTransient ?? false,
        endpoint: error?.endpoint ?? null,
        requestId: error?.requestId ?? null,
        traceId: error?.traceId ?? null,
        metaRequestId: error?.metaRequestId ?? null,
        actionRequired: error?.actionRequired ?? null,
        retryable: error?.retryable ?? false,
        outcomeUnknown: error?.outcomeUnknown ?? false,
        reason: error?.reason ?? null,
        stage: error?.stage ?? null,
        itemIndex: error?.itemIndex ?? null,
        createdObjects: error?.createdObjects ?? null,
        jobId: error?.jobId ?? null,
    };
}
