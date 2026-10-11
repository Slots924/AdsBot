const supportedPresets = new Set(["today", "yesterday", "last_7d", "last_30d", "maximum"]);

export default function campaignDateRange(preset = "today", timeZone = "Europe/Kyiv", now = new Date()) {
    if (!supportedPresets.has(preset)) {
        throw Object.assign(new Error("Непідтримуваний період статистики"), {
            code: "FACEBOOK_INSIGHTS_DATE_PRESET_INVALID",
        });
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const part = (type) => parts.find((item) => item.type === type).value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const shift = (days) => {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    };
    const until = preset === "yesterday" ? shift(-1) : today;
    const since = preset === "maximum" ? null
        : preset === "yesterday" ? until
            : shift(preset === "last_7d" ? -6 : preset === "last_30d" ? -29 : 0);
    return {
        datePreset: preset,
        timeZone,
        rangeKey: `${timeZone}::${since ?? "maximum"}::${until}`,
        timeRange: since ? { since, until } : null,
        asOf: until,
    };
}
