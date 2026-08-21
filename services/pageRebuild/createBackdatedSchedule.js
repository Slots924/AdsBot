const dayMs = 24 * 60 * 60 * 1000;


function createDateError(message, code = "PAGE_REBUILD_DATE_INVALID") {
    const error = new Error(message);
    error.code = code;
    return error;
}


function utcDay(value, label) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw createDateError(`Некоректна ${label}`);
    }
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    ));
}


function addMonths(date, count) {
    const result = new Date(date);
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);
    const lastDay = new Date(Date.UTC(
        result.getUTCFullYear(),
        result.getUTCMonth() + 1,
        0
    )).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
    return result;
}


const serial = (date) => Math.floor(date.getTime() / dayMs);
const fromSerial = (value) => new Date(value * dayMs);
const randomInteger = (minimum, maximum, random) => (
    minimum + Math.floor(random() * (maximum - minimum + 1))
);


function selectUniqueDays(minimum, maximum, count, random) {
    const available = maximum - minimum + 1;
    if (available < count) {
        throw createDateError(
            "У діапазоні дат недостатньо унікальних днів для всіх фотографій",
            "PAGE_REBUILD_DATE_RANGE_TOO_SMALL"
        );
    }
    const days = Array.from({ length: available }, (_item, index) => (
        minimum + index
    ));
    for (let index = 0; index < count; index += 1) {
        const selectedIndex = randomInteger(index, days.length - 1, random);
        [days[index], days[selectedIndex]] = [days[selectedIndex], days[index]];
    }
    return days.slice(0, count).sort((left, right) => left - right);
}


/** Створює впорядкований набір унікальних минулих дат для фото-постів. */
export default function createBackdatedSchedule({
    count,
    pageCreatedAt,
    now = new Date(),
    random = Math.random,
} = {}) {
    if (!Number.isInteger(count) || count < 1) {
        throw createDateError("Кількість фото-постів має бути додатним цілим числом");
    }
    const created = utcDay(pageCreatedAt, "дата створення фанпейджа");
    const today = utcDay(now, "поточна дата");
    if (created > today) {
        throw createDateError("Дата створення фанпейджа не може бути в майбутньому");
    }

    const isOldPage = addMonths(created, 6) <= today;
    let days;
    if (!isOldPage) {
        days = selectUniqueDays(serial(created), serial(today), count, random);
    } else if (count === 1) {
        days = selectUniqueDays(
            serial(addMonths(created, 1)),
            serial(addMonths(today, -1)),
            1,
            random
        );
    } else {
        const oldestMinimum = serial(addMonths(created, 1));
        const oldestMaximum = serial(addMonths(created, 3));
        const newestMinimum = serial(addMonths(today, -3));
        const newestMaximum = serial(addMonths(today, -1));
        const oldestUpperBound = Math.min(
            oldestMaximum,
            newestMaximum - count + 1
        );
        if (oldestUpperBound < oldestMinimum) {
            throw createDateError(
                "Діапазон дат фанпейджа замалий для всіх фотографій",
                "PAGE_REBUILD_DATE_RANGE_TOO_SMALL"
            );
        }
        const oldest = randomInteger(oldestMinimum, oldestUpperBound, random);
        const newestLowerBound = Math.max(
            newestMinimum,
            oldest + count - 1
        );
        if (newestLowerBound > newestMaximum) {
            throw createDateError(
                "Діапазон дат фанпейджа замалий для всіх фотографій",
                "PAGE_REBUILD_DATE_RANGE_TOO_SMALL"
            );
        }
        const newest = randomInteger(newestLowerBound, newestMaximum, random);
        const middle = count > 2
            ? selectUniqueDays(oldest + 1, newest - 1, count - 2, random)
            : [];
        days = [oldest, ...middle, newest];
    }

    return days.map((day) => {
        const date = fromSerial(day);
        date.setUTCHours(0, 0, 0, 0);
        return date.toISOString();
    });
}


export { addMonths };
