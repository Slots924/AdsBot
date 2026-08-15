import axios from "axios";


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
    async request(method, url, data = null) {
        const sendRequest = async () => {
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

            return axios({
                method,
                url,
                data,
                headers: this.headers,
                timeout: 60000,
            });
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


    // Відкриває профіль за його номером
    async openProfile(profileNo) {
        const url =
            `${this.apiUrl}/api/v2/browser-profile/start`;

        const data = {
            profile_no: String(profileNo),
            last_opened_tabs: "0",
            proxy_detection: "0",
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
}


export default AdsPower;
