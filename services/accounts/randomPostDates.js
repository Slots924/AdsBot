const dayMs = 24 * 60 * 60 * 1000;
const twoMonthsMs = 60 * dayMs;
const fiveYearsMs = Math.round(5 * 365.25 * dayMs);


function toIsoDate(value) {
    return new Date(value).toISOString().slice(0, 10);
}


export default function createRandomPostDates(
    count,
    {
        now = Date.now(),
        random = Math.random,
        minAgeMs = twoMonthsMs,
        maxAgeMs = fiveYearsMs,
    } = {}
) {
    const size = Number(count);

    if (!Number.isInteger(size) || size <= 0) return [];

    const newest = Number(now) - minAgeMs;
    const oldest = Number(now) - maxAgeMs;
    const span = Math.max(1, newest - oldest);
    const dates = new Set();
    let guard = 0;

    while (dates.size < size && guard < size * 20) {
        const timestamp = oldest + Math.floor(random() * span);
        dates.add(toIsoDate(timestamp));
        guard += 1;
    }

    while (dates.size < size) {
        const fallback = newest - dates.size * dayMs;
        dates.add(toIsoDate(fallback));
    }

    return [...dates].sort();
}
