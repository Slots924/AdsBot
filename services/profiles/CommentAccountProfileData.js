import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import GrokClient from "../llm/grok/GrokClient.js";
import loadGrokSystemPrompt from "../llm/grok/loadGrokSystemPrompt.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");


function createProfileDataError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


const NAMES_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["names"],
    properties: {
        names: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["firstName", "lastName"],
                properties: {
                    firstName: { type: "string", minLength: 1 },
                    lastName: { type: "string", minLength: 1 },
                },
            },
        },
    },
};

const COMPANIES_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["companies"],
    properties: {
        companies: {
            type: "array",
            items: { type: "string", minLength: 1 },
        },
    },
};

const UNIVERSITIES_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["universities"],
    properties: {
        universities: {
            type: "array",
            items: { type: "string", minLength: 1 },
        },
    },
};

const PROFESSIONS_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["professions"],
    properties: {
        professions: {
            type: "array",
            items: { type: "string", minLength: 1 },
        },
    },
};


function normalizeGeoCode(geo) {
    const code = String(geo ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
        throw createProfileDataError(
            `Гео має бути двобуквеним кодом (US, DE, UK, UA). Отримано: "${geo}"`,
            "PROFILE_DATA_VALIDATION_ERROR"
        );
    }
    return code === "GB" ? "UK" : code;
}


function normalizeCount(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        throw createProfileDataError(
            `${label} має бути цілим числом 0 або більше`,
            "PROFILE_DATA_VALIDATION_ERROR"
        );
    }
    return number;
}


async function ensureDirectory(dirPath) {
    await mkdir(dirPath, { recursive: true });
}


export default class CommentAccountProfileData {
    constructor({
        grokClient,
        dataRoot,
        promptsRoot,
    } = {}) {
        // Зберігаємо переданий клієнт, але не створюємо GrokClient тут.
        // Створимо тільки при потребі генерації (лениво), щоб не вимагати ключі коли дані вже є.
        this.grokClient = grokClient ?? null;

        const root = dataRoot
            ? path.resolve(dataRoot)
            : path.join(projectRoot, "data", "generated-profiles-data");

        this.dataRoot = root;
        this.namesManDir = path.join(root, "names", "man");
        this.namesWomanDir = path.join(root, "names", "woman");
        this.companiesDir = path.join(root, "companies");
        this.universitiesDir = path.join(root, "universities");
        this.professionsDir = path.join(root, "professions");

        const prompts = promptsRoot
            ? path.resolve(promptsRoot)
            : path.join(projectRoot, "data", "prompts", "grok");

        this.namesPromptFile = path.join(prompts, "generate-names.txt");
        this.companiesPromptFile = path.join(prompts, "generate-companies.txt");
        this.universitiesPromptFile = path.join(prompts, "generate-universities.txt");
        this.translateProfPromptFile = path.join(prompts, "translate-professions.txt");
    }

    #getGrokClient() {
        if (this.grokClient) {
            return this.grokClient;
        }
        const client = new GrokClient();
        if (typeof client?.generateJson !== "function") {
            throw createProfileDataError(
                "Grok-клієнт не містить методу generateJson",
                "PROFILE_DATA_VALIDATION_ERROR"
            );
        }
        this.grokClient = client;
        return client;
    }


    // Основний публічний метод: повертає дані для коментарних акаунтів
    async getCommentAccountProfiles({ geo, maleCount = 0, femaleCount = 0 } = {}) {
        const geoCode = normalizeGeoCode(geo);
        const mCount = normalizeCount(maleCount, "Кількість чоловічих профілів");
        const fCount = normalizeCount(femaleCount, "Кількість жіночих профілів");
        const total = mCount + fCount;

        if (total === 0) {
            throw createProfileDataError(
                "Потрібна хоча б одна кількість чоловічих або жіночих профілів",
                "PROFILE_DATA_VALIDATION_ERROR"
            );
        }

        console.log(`[CommentAccountProfileData] Підготовка профілів для ${geoCode} (чоловіків: ${mCount}, жінок: ${fCount})...`);

        // Забезпечуємо наявність даних тільки для тих, кого запитуємо (щоб не генерувати жіночі імена коли просять 0)
        const maleNames = mCount > 0 ? await this.#ensureNames(geoCode, "male") : [];
        const femaleNames = fCount > 0 ? await this.#ensureNames(geoCode, "female") : [];
        const companies = await this.#ensureCompanies(geoCode);
        const universities = await this.#ensureUniversities(geoCode);
        const professions = await this.#ensureProfessions(geoCode);

        // Беремо перші N елементів (з циклічним взяттям якщо мало)
        const maleTake = this.#takeItems(maleNames, mCount);
        const femaleTake = this.#takeItems(femaleNames, fCount);
        const compTake = this.#takeItems(companies, total);
        const uniTake = this.#takeItems(universities, total);
        const profTake = this.#takeItems(professions, total);

        // Зберігаємо ротацію тільки для тих, кого використовували
        if (mCount > 0) await this.#saveNames(geoCode, "male", maleTake.remaining);
        if (fCount > 0) await this.#saveNames(geoCode, "female", femaleTake.remaining);
        await this.#saveCompanies(geoCode, compTake.remaining);
        await this.#saveUniversities(geoCode, uniTake.remaining);
        await this.#saveProfessions(geoCode, profTake.remaining);

        // Формуємо профілі
        const profiles = [];

        for (let i = 0; i < mCount; i++) {
            const name = maleTake.used[i % maleTake.used.length] || maleTake.used[0];
            const idx = i;
            profiles.push({
                firstName: name.firstName,
                lastName: name.lastName,
                gender: "male",
                company: compTake.used[idx] || compTake.used[0] || "",
                profession: profTake.used[idx] || profTake.used[0] || "",
                university: uniTake.used[idx] || uniTake.used[0] || "",
            });
        }

        for (let i = 0; i < fCount; i++) {
            const name = femaleTake.used[i % femaleTake.used.length] || femaleTake.used[0];
            const idx = mCount + i;
            profiles.push({
                firstName: name.firstName,
                lastName: name.lastName,
                gender: "female",
                company: compTake.used[idx] || compTake.used[0] || "",
                profession: profTake.used[idx] || profTake.used[0] || "",
                university: uniTake.used[idx] || uniTake.used[0] || "",
            });
        }

        return {
            geo: geoCode,
            profiles,
        };
    }


    // ===== Внутрішні методи =====

    async #readJsonSafe(filePath) {
        try {
            const content = await readFile(filePath, "utf8");
            return JSON.parse(content);
        } catch (err) {
            if (err.code === "ENOENT") {
                return null;
            }
            throw createProfileDataError(
                `Не вдалося прочитати файл даних "${filePath}": ${err.message}`,
                "PROFILE_DATA_FILE_ERROR",
                { cause: err }
            );
        }
    }

    async #writeJsonSafe(filePath, data) {
        await ensureDirectory(path.dirname(filePath));
        const json = JSON.stringify(data, null, 2);
        await writeFile(filePath, json, "utf8");
    }

    #takeItems(list, count) {
        if (!Array.isArray(list) || list.length === 0 || count <= 0) {
            return { used: [], remaining: list || [] };
        }
        const used = [];
        for (let i = 0; i < count; i++) {
            used.push(list[i % list.length]);
        }
        const rotateBy = Math.min(count, list.length);
        const remaining = [
            ...list.slice(rotateBy),
            ...list.slice(0, rotateBy),
        ];
        return { used, remaining };
    }

    // --- Names ---

    async #loadNames(geoCode, gender) {
        const dir = gender === "male" ? this.namesManDir : this.namesWomanDir;
        const filePath = path.join(dir, `${geoCode}.json`);
        const raw = await this.#readJsonSafe(filePath);
        if (!Array.isArray(raw)) return [];
        return raw
            .map((entry) => ({
                firstName: String(entry?.firstName ?? entry?.first_name ?? "").trim(),
                lastName: String(entry?.lastName ?? entry?.last_name ?? "").trim(),
            }))
            .filter((n) => n.firstName && n.lastName);
    }

    async #saveNames(geoCode, gender, names) {
        const dir = gender === "male" ? this.namesManDir : this.namesWomanDir;
        const filePath = path.join(dir, `${geoCode}.json`);
        const toSave = names.map((n) => ({
            firstName: n.firstName,
            lastName: n.lastName,
        }));
        await this.#writeJsonSafe(filePath, toSave);
    }

    async #ensureNames(geoCode, gender) {
        let list = await this.#loadNames(geoCode, gender);
        if (list.length > 0) {
            return list;
        }

        const genderLabel = gender === "male" ? "чоловічі" : "жіночі";
        console.log(`[CommentAccountProfileData] Дані відсутні. Генеруємо ${genderLabel} імена для ${geoCode} (~200 записів). Це може зайняти кілька хвилин...`);

        list = await this.#generateNames(geoCode, gender);
        await this.#saveNames(geoCode, gender, list);

        console.log(`[CommentAccountProfileData] ${genderLabel} імена для ${geoCode} згенеровано та збережено.`);
        return list;
    }

    async #generateNames(geoCode, gender, count = 200) {
        const systemPrompt = await loadGrokSystemPrompt(this.namesPromptFile);
        const userPrompt = [
            `geo: ${geoCode}`,
            `gender: ${gender}`,
            `count: ${count}`,
            "",
            "Згенеруй список імен згідно правил у файлі промпту. Поверни тільки JSON.",
        ].join("\n");

        console.log(`[CommentAccountProfileData] Надсилаємо запит до Grok для генерації імен...`);
        const result = await this.#getGrokClient().generateJson({
            systemPrompt,
            prompt: userPrompt,
            schema: NAMES_SCHEMA,
            schemaName: "names_list",
        });

        const rawNames = result?.data?.names;
        if (!Array.isArray(rawNames) || rawNames.length === 0) {
            throw createProfileDataError(
                `Grok не повернув список імен для ${gender} ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        const normalized = rawNames
            .map((n) => ({
                firstName: String(n?.firstName ?? n?.first_name ?? "").trim(),
                lastName: String(n?.lastName ?? n?.last_name ?? "").trim(),
            }))
            .filter((n) => n.firstName && n.lastName)
            .slice(0, count);

        if (normalized.length === 0) {
            throw createProfileDataError(
                `Grok повернув некоректні імена для ${gender} ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        console.log(`[CommentAccountProfileData] Grok успішно повернув ${normalized.length} імен.`);
        return normalized;
    }

    // --- Companies ---

    async #loadCompanies(geoCode) {
        const filePath = path.join(this.companiesDir, `${geoCode}.json`);
        const raw = await this.#readJsonSafe(filePath);
        if (!Array.isArray(raw)) return [];
        return raw.map((c) => String(c ?? "").trim()).filter(Boolean);
    }

    async #saveCompanies(geoCode, companies) {
        const filePath = path.join(this.companiesDir, `${geoCode}.json`);
        await this.#writeJsonSafe(filePath, companies);
    }

    async #ensureCompanies(geoCode) {
        let list = await this.#loadCompanies(geoCode);
        if (list.length > 0) return list;

        console.log(`[CommentAccountProfileData] Дані відсутні. Генеруємо компанії для ${geoCode} (~50 записів). Це може зайняти кілька хвилин...`);

        list = await this.#generateCompanies(geoCode);
        await this.#saveCompanies(geoCode, list);

        console.log(`[CommentAccountProfileData] Компанії для ${geoCode} згенеровано та збережено.`);
        return list;
    }

    async #generateCompanies(geoCode, count = 50) {
        const systemPrompt = await loadGrokSystemPrompt(this.companiesPromptFile);
        const userPrompt = [
            `geo: ${geoCode}`,
            `count: ${count}`,
            "Згенеруй список компаній згідно правил. Поверни тільки JSON.",
        ].join("\n");

        console.log(`[CommentAccountProfileData] Надсилаємо запит до Grok (з web search) для генерації компаній...`);
        const result = await this.#getGrokClient().generateJson({
            systemPrompt,
            prompt: userPrompt,
            schema: COMPANIES_SCHEMA,
            schemaName: "companies_list",
            search: true,
        });

        const raw = result?.data?.companies;
        if (!Array.isArray(raw) || raw.length === 0) {
            throw createProfileDataError(
                `Grok не повернув список компаній для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        const normalized = raw
            .map((c) => String(c).trim())
            .filter(Boolean)
            .slice(0, count);

        if (normalized.length === 0) {
            throw createProfileDataError(
                `Grok повернув порожній список компаній для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        console.log(`[CommentAccountProfileData] Grok успішно повернув ${normalized.length} компаній.`);
        return normalized;
    }

    // --- Universities ---

    async #loadUniversities(geoCode) {
        const filePath = path.join(this.universitiesDir, `${geoCode}.json`);
        const raw = await this.#readJsonSafe(filePath);
        if (!Array.isArray(raw)) return [];
        return raw.map((u) => String(u ?? "").trim()).filter(Boolean);
    }

    async #saveUniversities(geoCode, universities) {
        const filePath = path.join(this.universitiesDir, `${geoCode}.json`);
        await this.#writeJsonSafe(filePath, universities);
    }

    async #ensureUniversities(geoCode) {
        let list = await this.#loadUniversities(geoCode);
        if (list.length > 0) return list;

        console.log(`[CommentAccountProfileData] Дані відсутні. Генеруємо університети/коледжі для ${geoCode} (~50 записів). Це може зайняти кілька хвилин...`);

        list = await this.#generateUniversities(geoCode);
        await this.#saveUniversities(geoCode, list);

        console.log(`[CommentAccountProfileData] Університети для ${geoCode} згенеровано та збережено.`);
        return list;
    }

    async #generateUniversities(geoCode, count = 50) {
        const systemPrompt = await loadGrokSystemPrompt(this.universitiesPromptFile);
        const userPrompt = [
            `geo: ${geoCode}`,
            `count: ${count}`,
            "Згенеруй список університетів/коледжів згідно правил. Поверни тільки JSON.",
        ].join("\n");

        console.log(`[CommentAccountProfileData] Надсилаємо запит до Grok (з web search) для генерації університетів...`);
        const result = await this.#getGrokClient().generateJson({
            systemPrompt,
            prompt: userPrompt,
            schema: UNIVERSITIES_SCHEMA,
            schemaName: "universities_list",
            search: true,
        });

        const raw = result?.data?.universities;
        if (!Array.isArray(raw) || raw.length === 0) {
            throw createProfileDataError(
                `Grok не повернув список університетів для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        const normalized = raw
            .map((u) => String(u).trim())
            .filter(Boolean)
            .slice(0, count);

        if (normalized.length === 0) {
            throw createProfileDataError(
                `Grok повернув порожній список університетів для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        console.log(`[CommentAccountProfileData] Grok успішно повернув ${normalized.length} університетів.`);
        return normalized;
    }

    // --- Professions ---

    async #loadBaseProfessions() {
        const baseFile = path.join(this.professionsDir, "professions.json");
        const raw = await this.#readJsonSafe(baseFile);
        if (!Array.isArray(raw)) return [];
        return raw
            .map((p) => String(p?.profession ?? p ?? "").trim())
            .filter(Boolean);
    }

    async #loadProfessions(geoCode) {
        // Тільки файл для конкретного гео. Якщо немає — повертаємо порожній, щоб ensure вирішив.
        const geoFile = path.join(this.professionsDir, `${geoCode}.json`);
        const rawGeo = await this.#readJsonSafe(geoFile);
        if (Array.isArray(rawGeo) && rawGeo.length > 0) {
            return rawGeo.map((p) => String(p ?? "").trim()).filter(Boolean);
        }
        return [];
    }

    async #saveProfessions(geoCode, professions) {
        const filePath = path.join(this.professionsDir, `${geoCode}.json`);
        await this.#writeJsonSafe(filePath, professions);
    }

    async #ensureProfessions(geoCode) {
        let list = await this.#loadProfessions(geoCode);
        if (list.length > 0) {
            return list;
        }

        const base = await this.#loadBaseProfessions();
        if (base.length === 0) {
            throw createProfileDataError(
                "Не вдалося завантажити базовий список професій",
                "PROFILE_DATA_FILE_ERROR"
            );
        }

        if (geoCode === "UA") {
            list = base;
            await this.#saveProfessions("UA", list);
        } else {
            console.log(`[CommentAccountProfileData] Дані відсутні. Генеруємо переклад професій для ${geoCode}. Це може зайняти кілька хвилин...`);
            list = await this.#translateProfessions(geoCode, base);
            await this.#saveProfessions(geoCode, list);
            console.log(`[CommentAccountProfileData] Професії для ${geoCode} перекладено та збережено.`);
        }

        return list;
    }

    async #translateProfessions(geoCode, baseList) {
        const systemPrompt = await loadGrokSystemPrompt(this.translateProfPromptFile);
        const userPrompt = [
            `geo: ${geoCode}`,
            `professions: ${JSON.stringify(baseList)}`,
            "Переклади/адаптуй список професій. Поверни тільки JSON.",
        ].join("\n");

        console.log(`[CommentAccountProfileData] Надсилаємо запит до Grok для перекладу професій...`);
        const result = await this.#getGrokClient().generateJson({
            systemPrompt,
            prompt: userPrompt,
            schema: PROFESSIONS_SCHEMA,
            schemaName: "professions_list",
        });

        const raw = result?.data?.professions;
        if (!Array.isArray(raw) || raw.length === 0) {
            throw createProfileDataError(
                `Grok не повернув перекладений список професій для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        const normalized = raw
            .map((p) => String(p).trim())
            .filter(Boolean)
            .slice(0, baseList.length);

        if (normalized.length === 0) {
            throw createProfileDataError(
                `Grok повернув порожній переклад професій для ${geoCode}`,
                "PROFILE_DATA_GENERATION_ERROR"
            );
        }

        console.log(`[CommentAccountProfileData] Grok успішно повернув ${normalized.length} перекладених професій.`);
        return normalized;
    }
}
