import axios from "axios";
import { getLogger } from "../services/logging/runtimeLogger.js";


class AdsPower {
    constructor() {
        this.apiUrl = process.env.ADSPOWER_API_URL;
        this.apiKey = process.env.ADSPOWER_API_KEY;

        this.headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };

        // Мінімальна пауза між запитами AdsPower
        this.requestDelay = 1100;

        // Час запуску останнього запиту
        this.lastRequestTime = 0;

        // Спільна черга всіх запитів
        this.requestQueue = Promise.resolve();
    }


    // Проста пауза
    async wait(milliseconds) {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }


    // Усі запити до AdsPower проходять через цей метод
    async request(method, url, data = null, params = null) {
        const sendRequest = async () => {
            const startedAt = Date.now();
            const logger = getLogger("adspower");
            const timePassed =
                Date.now() - this.lastRequestTime;

            const timeToWait = Math.max(
                0,
                this.requestDelay - timePassed
            );

            if (timeToWait > 0) {
                await this.wait(timeToWait);
            }

            // Запам'ятовуємо час запуску запиту
            this.lastRequestTime = Date.now();

            const endpoint = (() => {
                try { return new URL(url).pathname; } catch { return "unknown"; }
            })();
            logger.debug("adspower.request", "Надсилаємо запит до AdsPower", { method, endpoint });
            try {
                const response = await axios({
                    method,
                    url,
                    data,
                    params,
                    headers: this.headers,
                    timeout: 60000,
                });
                logger.debug("adspower.response", "AdsPower відповів", {
                    method,
                    endpoint,
                    durationMs: Date.now() - startedAt,
                    status: response.status,
                    code: response.data?.code,
                });
                return response;
            } catch (error) {
                logger.error("adspower.request.failed", "Запит до AdsPower завершився помилкою", {
                    method,
                    endpoint,
                    durationMs: Date.now() - startedAt,
                    error,
                });
                throw error;
            }
        };


        /*
            Додаємо запит у спільну чергу.

            Навіть якщо кілька функцій викличуть AdsPower
            одночасно, запити виконаються по черзі.
        */
        const currentRequest = this.requestQueue.then(
            sendRequest,
            sendRequest
        );

        /*
            Помилка одного запиту не повинна
            зупиняти всю наступну чергу.
        */
        this.requestQueue = currentRequest.catch(() => {});

        return currentRequest;
    }


    // Відкриває профіль за його номером із параметрами конкретного сценарію
    async openProfile(profileNo, options = null) {
        const url =
            `${this.apiUrl}/api/v2/browser-profile/start`;

        const data = {
            profile_no: String(profileNo),
            last_opened_tabs: "0",
            proxy_detection: "0",
        };

        if (options && typeof options === "object") {
            data.headless = options.browserMode === "headless" ? "1" : "0";

            if (options.disableImages === true) {
                data.launch_args = [
                    "--blink-settings=imagesEnabled=false",
                ];
            }
        }

        try {
            const response = await this.request(
                "post",
                url,
                data
            );

            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result.data;

        } catch (error) {
            const message =
                error.response?.data?.msg ||
                error.message ||
                "Невідома помилка";

            throw new Error(
                `Не вдалося відкрити профіль ${profileNo}: ${message}`
            );
        }
    }


    // Отримує інформацію про відкриття профілю на всіх пристроях
    async getCloudProfileStatus(profileId) {
        const url =
            `${this.apiUrl}/api/v1/browser/cloud-active`;

        try {
            if (
                profileId === undefined
                || profileId === null
                || String(profileId).trim() === ""
            ) {
                throw new Error(
                    "Не вказано profile_id"
                );
            }

            const response = await this.request(
                "post",
                url,
                {
                    user_ids: String(profileId),
                }
            );

            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            if (!Array.isArray(result.data)) {
                throw new Error(
                    "AdsPower повернув некоректний статус профілю"
                );
            }

            return result.data;

        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";

            throw new Error(
                `Не вдалося перевірити хмарний статус профілю ${profileId}: ${message}`
            );
        }
    }


    // Закриває профіль за його номером
    async closeProfile(profileNo) {
        const url =
            `${this.apiUrl}/api/v2/browser-profile/stop`;

        const data = {
            profile_no: String(profileNo),
        };

        try {
            const response = await this.request(
                "post",
                url,
                data
            );

            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result;

        } catch (error) {
            const message =
                error.response?.data?.msg ||
                error.message ||
                "Невідома помилка";

            throw new Error(
                `Не вдалося закрити профіль ${profileNo}: ${message}`
            );
        }
    }


    // Отримує інформацію про профіль за його номером
    async getProfileByNo(profileNo) {
        const url =
            `${this.apiUrl}/api/v2/browser-profile/list`;

        const data = {
            profile_no: [String(profileNo)],
            page: "1",
            limit: "1",
        };

        try {
            const response = await this.request(
                "post",
                url,
                data
            );

            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            const profile = result.data?.list?.[0];

            if (!profile) {
                throw new Error(
                    `Профіль із номером ${profileNo} не знайдений`
                );
            }

            return profile;

        } catch (error) {
            const message =
                error.response?.data?.msg ||
                error.message ||
                "Невідома помилка";

            throw new Error(
                `Не вдалося отримати профіль ${profileNo}: ${message}`
            );
        }
    }


    // Отримує список груп AdsPower
    async getGroups() {
        const limit = 100;
        const groups = [];
        let page = 1;

        try {
            while (true) {
                const url = `${this.apiUrl}/api/v1/group/list`;
                const response = await this.request(
                    "get",
                    url,
                    null,
                    {
                        page: String(page),
                        page_size: String(limit),
                    }
                );
                const result = response.data;

                if (result.code !== 0) {
                    throw new Error(
                        `AdsPower code=${result.code}, msg=${result.msg}`
                    );
                }

                const currentGroups = result.data?.list;

                if (!Array.isArray(currentGroups)) {
                    throw new Error(
                        "AdsPower повернув некоректний список груп"
                    );
                }

                groups.push(...currentGroups);

                if (currentGroups.length < limit) {
                    break;
                }

                page += 1;
            }

            return groups;
        } catch (error) {
            const status = error.response?.status;
            const responseData = error.response?.data;
            const message =
                responseData?.msg
                || error.message
                || "Невідома помилка";
            const details = [
                status ? `HTTP ${status}` : null,
                responseData?.code !== undefined
                    ? `AdsPower code=${responseData.code}`
                    : null,
                message,
            ].filter(Boolean).join(", ");

            const wrappedError = new Error(
                `Не вдалося отримати список груп AdsPower: ${details}`
            );
            wrappedError.status = status;

            throw wrappedError;
        }
    }


    async getProfiles() {
        return this.getProfilesPageByPage();
    }


    // Отримує всі профілі вказаної групи AdsPower
    async getProfilesByGroupId(groupId) {
        const normalizedGroupId = String(groupId ?? "").trim();

        if (!normalizedGroupId) {
            throw new Error("Не вказано ID групи AdsPower");
        }

        return this.getProfilesPageByPage(normalizedGroupId);
    }


    // Централізовано отримує профілі через Profile API V2 із пагінацією
    async getProfilesPageByPage(groupId = null) {
        const limit = 100;
        const profiles = [];
        let page = 1;

        try {
            while (true) {
                const url =
                    `${this.apiUrl}/api/v2/browser-profile/list`;
                const data = {
                    sort_type: "profile_no",
                    sort_order: "asc",
                    page: String(page),
                    limit: String(limit),
                };

                if (groupId !== null) {
                    data.group_id = groupId;
                }

                const response = await this.request("post", url, data);
                const result = response.data;

                if (result.code !== 0) {
                    throw new Error(result.msg);
                }

                const currentProfiles = result.data?.list;

                if (!Array.isArray(currentProfiles)) {
                    throw new Error(
                        "AdsPower повернув некоректний список профілів"
                    );
                }

                profiles.push(...currentProfiles);

                if (currentProfiles.length < limit) {
                    break;
                }

                page += 1;
            }

            return profiles;
        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";
            const scope = groupId === null
                ? "всі профілі AdsPower"
                : `профілі групи ${groupId}`;

            throw new Error(
                `Не вдалося отримати ${scope}: ${message}`
            );
        }
    }


    // Отримує список тегів AdsPower
    async listBrowserTags() {
        const limit = 100;
        const tags = [];
        let page = 1;

        try {
            while (true) {
                const url = `${this.apiUrl}/api/v2/browser-tags/list`;
                const response = await this.request(
                    "post",
                    url,
                    {
                        page,
                        page_size: limit,
                    }
                );
                const result = response.data;

                if (result.code !== 0) {
                    throw new Error(result.msg);
                }

                const currentTags = result.data?.list;

                if (!Array.isArray(currentTags)) {
                    throw new Error(
                        "AdsPower повернув некоректний список тегів"
                    );
                }

                tags.push(...currentTags);

                if (currentTags.length < limit) {
                    break;
                }

                page += 1;
            }

            return tags;
        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";

            throw new Error(
                `Не вдалося отримати список тегів AdsPower: ${message}`
            );
        }
    }


    // Додає або замінює теги профілю
    async updateProfileTags(
        profileId,
        tagIds,
        updateType = "2"
    ) {
        const url =
            `${this.apiUrl}/api/v2/browser-profile/update`;

        const data = {
            profile_id: String(profileId),
            profile_tag_ids: tagIds.map(String),

            /*
                "1" — замінити всі теги
                "2" — додати до існуючих
            */
            tags_update_type: String(updateType),
        };

        try {
            const response = await this.request(
                "post",
                url,
                data
            );

            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result.data ?? result;

        } catch (error) {
            const message =
                error.response?.data?.msg ||
                error.message ||
                "Невідома помилка";

            throw new Error(
                `Не вдалося оновити теги профілю ${profileId}: ${message}`
            );
        }
    }


    // Оновлює відображувану назву AdsPower-профілю
    async updateProfileName(profileId, name) {
        const normalizedProfileId = String(profileId ?? "").trim();
        const normalizedName = String(name ?? "").trim();

        if (!normalizedProfileId) {
            throw new Error("Не вказано profile_id AdsPower-профілю");
        }

        if (!normalizedName) {
            throw new Error("Назва AdsPower-профілю не може бути порожньою");
        }

        if (normalizedName.length > 100) {
            throw new Error(
                "Назва AdsPower-профілю не може перевищувати 100 символів"
            );
        }

        const url =
            `${this.apiUrl}/api/v2/browser-profile/update`;

        try {
            const response = await this.request(
                "post",
                url,
                {
                    profile_id: normalizedProfileId,
                    name: normalizedName,
                }
            );
            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result.data ?? result;
        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";

            throw new Error(
                `Не вдалося оновити назву AdsPower-профілю ${normalizedProfileId}: ${message}`
            );
        }
    }


    // Переміщує профіль в іншу групу AdsPower
    async updateProfileGroup(profileId, groupId) {
        const normalizedProfileId = String(profileId ?? "").trim();
        const normalizedGroupId = String(groupId ?? "").trim();

        if (!normalizedProfileId) {
            throw new Error("Не вказано profile_id AdsPower-профілю");
        }

        if (!normalizedGroupId) {
            throw new Error("Не вказано ID групи AdsPower");
        }

        const url = `${this.apiUrl}/api/v2/browser-profile/update`;

        try {
            const response = await this.request(
                "post",
                url,
                {
                    profile_id: normalizedProfileId,
                    group_id: normalizedGroupId,
                }
            );
            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result.data ?? result;
        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";

            throw new Error(
                `Не вдалося перемістити профіль ${normalizedProfileId} у групу ${normalizedGroupId}: ${message}`
            );
        }
    }


    // Ставить проксі на AdsPower-профіль
    async updateProfileProxy(profileId, userProxyConfig) {
        const normalizedProfileId = String(profileId ?? "").trim();

        if (!normalizedProfileId) {
            throw new Error("Не вказано profile_id AdsPower-профілю");
        }

        if (!userProxyConfig || typeof userProxyConfig !== "object") {
            throw new Error("Не передано налаштування проксі AdsPower-профілю");
        }

        const url =
            `${this.apiUrl}/api/v2/browser-profile/update`;

        try {
            const response = await this.request(
                "post",
                url,
                {
                    profile_id: normalizedProfileId,
                    user_proxy_config: userProxyConfig,
                }
            );
            const result = response.data;

            if (result.code !== 0) {
                throw new Error(result.msg);
            }

            return result.data ?? result;
        } catch (error) {
            const message =
                error.response?.data?.msg
                || error.message
                || "Невідома помилка";

            throw new Error(
                `Не вдалося оновити проксі AdsPower-профілю ${normalizedProfileId}: ${message}`
            );
        }
    }
}


export default AdsPower;
