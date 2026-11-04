// Обидва вікна мають спільний UI, але HTTP-режим викликає лише власний backend.
export default function personalAutouploadApi(api) {
    const call = (action, sessionId, input = {}) => api.personalAutoupload(action, { sessionId, ...input });
    return {
        ...api,
        startPersonalAccountSession: profileNo => api.personalAutoupload("start", { profileNo }),
        switchPersonalAccountProfile: async (sessionId, profileNo) => {
            const result = await api.personalAutoupload("start", { profileNo });
            if (!result.ok) return result;
            if (sessionId && sessionId !== result.data.id) await call("disconnect", sessionId);
            return { ok: true, data: { session: result.data, profile: result.data.profile } };
        },
        getPersonalAccountSession: sessionId => call("get", sessionId),
        refreshPersonalAccountOverview: sessionId => call("overview", sessionId),
        getPersonalAdAccounts: sessionId => call("accounts", sessionId),
        checkPersonalBusinessInfo: (sessionId, input) => call("business.check", sessionId, input),
        updatePersonalBusinessInfo: (sessionId, input) => call("business.update", sessionId, input),
        checkPersonalPaymentSources: (sessionId, input) => call("payment.check", sessionId, input),
        addPersonalCreditCard: async (sessionId, input) => {
            const response = await call("payment.add", sessionId, input);
            if (!response?.ok || response.data?.success !== false) return response;
            const result = response.data;
            return { ok: false, error: { ...result, code: result.status,
                message: result.error || "Facebook не підтвердив додавання карти",
                paymentMethodId: result.data?.paymentMethodId ?? null } };
        },
        checkPersonalPhoneVerification: (sessionId, input) => call("phone.check", sessionId, input),
        requestPersonalPhoneCode: (sessionId, input) => call("phone.request", sessionId, input),
        submitPersonalPhoneCode: (sessionId, input) => call("phone.submit", sessionId, input),
        getPersonalPixels: (sessionId, adAccountId) => call("pixels", sessionId, { adAccountId }),
        createPersonalPixel: (sessionId, input) => call("pixel.create", sessionId, input),
        createPersonalApiProfile: (sessionId, input) => call("api.create", sessionId, input),
        disconnectPersonalAccountSession: sessionId => call("disconnect", sessionId),
        closePersonalAccountProfile: sessionId => call("close", sessionId),
    };
}
