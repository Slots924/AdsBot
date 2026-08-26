import path from "node:path";
import { fileURLToPath } from "node:url";

import GrokClient from "../llm/grok/GrokClient.js";
import loadGrokSystemPrompt
    from "../llm/grok/loadGrokSystemPrompt.js";


const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);


const PERSONA_FIELDS = [
    "bio",
    "education",
    "firstName",
    "gender",
    "lastName",
    "work",
];

const WORK_FIELDS = ["company", "position"];

export const COMMENT_ACCOUNT_PERSONA_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["geo", "profiles"],
    properties: {
        geo: {
            type: "string",
            minLength: 1,
            maxLength: 80,
        },
        profiles: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "gender",
                    "firstName",
                    "lastName",
                    "bio",
                    "work",
                    "education",
                ],
                properties: {
                    gender: {
                        type: "string",
                        enum: ["male", "female"],
                    },
                    firstName: {
                        type: "string",
                        minLength: 1,
                    },
                    lastName: {
                        type: "string",
                        minLength: 1,
                    },
                    bio: {
                        type: "string",
                        minLength: 1,
                    },
                    work: {
                        type: "object",
                        additionalProperties: false,
                        required: ["company", "position"],
                        properties: {
                            company: {
                                type: "string",
                                minLength: 1,
                            },
                            position: {
                                type: "string",
                                minLength: 1,
                            },
                        },
                    },
                    education: {
                        type: "string",
                        minLength: 1,
                    },
                },
            },
        },
    },
};


function createPersonaError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function isPlainObject(value) {
    return Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
    );
}


function hasExactFields(value, fields) {
    return isPlainObject(value)
        && JSON.stringify(Object.keys(value).sort())
            === JSON.stringify([...fields].sort());
}


export function normalizeGeoCode(geo) {
    const normalizedGeo = String(geo ?? "").replace(/\s+/g, " ").trim();

    if (!normalizedGeo) {
        throw createPersonaError(
            "Вкажіть країну або аудиторію, наприклад поляки або CZ",
            "PERSONA_VALIDATION_ERROR"
        );
    }

    if (normalizedGeo.length > 80) {
        throw createPersonaError(
            "Назва країни занадто довга",
            "PERSONA_VALIDATION_ERROR"
        );
    }

    return normalizedGeo;
}


function normalizeCount(value, label) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < 0) {
        throw createPersonaError(
            `${label} має бути цілим числом 0 або більше`,
            "PERSONA_VALIDATION_ERROR"
        );
    }

    return number;
}


function normalizeExcludedNames(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw createPersonaError(
            "Список заборонених імен має бути масивом",
            "PERSONA_VALIDATION_ERROR"
        );
    }

    return [...new Set(
        value
            .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
    )];
}


function normalizePersonName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}


function normalizeNameKey(value) {
    return normalizePersonName(value).toLocaleLowerCase();
}


function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}


function isValidWork(work) {
    return hasExactFields(work, WORK_FIELDS)
        && isNonEmptyString(work.company)
        && isNonEmptyString(work.position);
}


export function isValidCommentAccountPersona(persona) {
    return hasExactFields(persona, PERSONA_FIELDS)
        && ["male", "female"].includes(persona.gender)
        && isNonEmptyString(persona.firstName)
        && isNonEmptyString(persona.lastName)
        && typeof persona.bio === "string"
        && isNonEmptyString(persona.education)
        && isValidWork(persona.work);
}


function personaUsesExcludedName(persona, excludedKeys) {
    const firstName = normalizeNameKey(persona.firstName);
    const lastName = normalizeNameKey(persona.lastName);
    const fullName = `${firstName} ${lastName}`.trim();

    return excludedKeys.some((item) => (
        item === fullName
        || item === firstName
        || item === lastName
    ));
}


export function normalizeCommentAccountPersonas(value, {
    geo,
    maleCount,
    femaleCount,
    excludedNames = [],
} = {}) {
    if (!isPlainObject(value) || !Array.isArray(value.profiles)) {
        throw createPersonaError(
            "Grok повернув некоректний JSON персонажів",
            "PERSONA_INVALID_RESPONSE"
        );
    }

    const requestedGeo = normalizeGeoCode(geo);

    const profiles = value.profiles.map((persona, index) => {
        if (!isValidCommentAccountPersona(persona)) {
            throw createPersonaError(
                `Персонаж №${index + 1} має некоректні поля`,
                "PERSONA_INVALID_RESPONSE"
            );
        }

        return {
            gender: persona.gender,
            firstName: normalizePersonName(persona.firstName),
            lastName: normalizePersonName(persona.lastName),
            bio: String(persona.bio).trim(),
            education: String(persona.education).trim(),
            work: {
                company: String(persona.work.company).trim(),
                position: String(persona.work.position).trim(),
            },
        };
    });

    const maleProfiles = profiles.filter((item) => item.gender === "male");
    const femaleProfiles = profiles.filter((item) => item.gender === "female");

    if (profiles.length !== maleCount + femaleCount) {
        throw createPersonaError(
            `Очікували ${maleCount + femaleCount} персонажів, отримали ${profiles.length}`,
            "PERSONA_INVALID_RESPONSE"
        );
    }

    if (maleProfiles.length !== maleCount) {
        throw createPersonaError(
            `Очікували ${maleCount} чоловічих персонажів, отримали ${maleProfiles.length}`,
            "PERSONA_INVALID_RESPONSE"
        );
    }

    if (femaleProfiles.length !== femaleCount) {
        throw createPersonaError(
            `Очікували ${femaleCount} жіночих персонажів, отримали ${femaleProfiles.length}`,
            "PERSONA_INVALID_RESPONSE"
        );
    }

    const excludedKeys = excludedNames.map(normalizeNameKey);
    const seenNames = new Set();

    profiles.forEach((persona, index) => {
        const nameKey = `${normalizeNameKey(persona.firstName)} ${
            normalizeNameKey(persona.lastName)
        }`;

        if (seenNames.has(nameKey)) {
            throw createPersonaError(
                `Ім’я «${persona.firstName} ${persona.lastName}» повторилося`,
                "PERSONA_INVALID_RESPONSE"
            );
        }

        seenNames.add(nameKey);

        if (personaUsesExcludedName(persona, excludedKeys)) {
            throw createPersonaError(
                `Персонаж №${index + 1} використовує заборонене ім’я`,
                "PERSONA_INVALID_RESPONSE"
            );
        }
    });

    return {
        geo: requestedGeo,
        profiles,
    };
}


function buildUserPrompt({
    geo,
    maleCount,
    femaleCount,
    excludedNames,
}) {
    const excludedText = excludedNames.length > 0
        ? excludedNames.join(", ")
        : "немає";

    return [
        `Країна для коментарів: ${geo}`,
        `Чоловічих акаунтів: ${maleCount}`,
        `Жіночих акаунтів: ${femaleCount}`,
        `Заборонені імена: ${excludedText}`,
        "",
        "Імена, мова, компанії й освіта мають пасувати саме до цієї аудиторії.",
        "Згенеруй валідний JSON з усіма персонажами.",
    ].join("\n");
}


export default class CommentAccountPersonaGenerator {
    constructor({
        grokClient,
        systemPromptFile = path.join(
            projectRoot,
            "data/prompts/grok/generate-comment-account-personas.txt"
        ),
    } = {}) {
        this.grokClient = grokClient ?? new GrokClient();

        if (typeof this.grokClient?.generateJson !== "function") {
            throw createPersonaError(
                "Grok-клієнт не містить методу generateJson",
                "PERSONA_VALIDATION_ERROR"
            );
        }

        this.systemPromptFile = path.resolve(systemPromptFile);
    }


    async generate({
        geo,
        maleCount,
        femaleCount,
        excludedNames,
    } = {}) {
        const normalizedGeo = normalizeGeoCode(geo);
        const normalizedMaleCount = normalizeCount(
            maleCount,
            "Кількість чоловічих акаунтів"
        );
        const normalizedFemaleCount = normalizeCount(
            femaleCount,
            "Кількість жіночих акаунтів"
        );
        const normalizedExcludedNames = normalizeExcludedNames(excludedNames);

        if (normalizedMaleCount + normalizedFemaleCount === 0) {
            throw createPersonaError(
                "Потрібен хоча б один чоловічий або жіночий акаунт",
                "PERSONA_VALIDATION_ERROR"
            );
        }

        const systemPrompt = await loadGrokSystemPrompt(this.systemPromptFile);
        const result = await this.grokClient.generateJson({
            systemPrompt,
            prompt: buildUserPrompt({
                geo: normalizedGeo,
                maleCount: normalizedMaleCount,
                femaleCount: normalizedFemaleCount,
                excludedNames: normalizedExcludedNames,
            }),
            schema: COMMENT_ACCOUNT_PERSONA_JSON_SCHEMA,
            schemaName: "comment_account_personas",
        });

        return normalizeCommentAccountPersonas(result.data, {
            geo: normalizedGeo,
            maleCount: normalizedMaleCount,
            femaleCount: normalizedFemaleCount,
            excludedNames: normalizedExcludedNames,
        });
    }
}
