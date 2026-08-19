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
        stage: error?.stage ?? null,
        itemIndex: error?.itemIndex ?? null,
        createdObjects: error?.createdObjects ?? null,
        jobId: error?.jobId ?? null,
    };
}
