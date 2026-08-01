import axios from "axios";

class AdsPower {
    constructor() {
        this.apiUrl = process.env.ADSPOWER_API_URL;
        this.apiKay = process.env.ADSPOWER_API_KEY;
        this.headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };
    }

    async openProfile(profileNo) {

        let url = `${this.apiUrl}/api/v2/browser-profile/start`;
        let data = {
                        profile_no: String(profileNo),
                        last_opened_tabs: "0",
                        proxy_detection: "0",
                    };
        let config = {
                        headers: this.headers,
                        timeout: 60000,
                    };            
        try {
            const response = await axios.post(url, data, config);

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


    async closeProfile(profileNo) {
        let url = `${this.apiUrl}/api/v2/browser-profile/stop`;
        let data = {
                        profile_no: String(profileNo),
                    };
        let config = {
                        headers: this.headers,
                        timeout: 60000,
                    };

        try {
            const response = await axios.post(url, data, config);

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

            throw new Error (
                `Не вдалося закрити профіль ${profileNo}: ${message}`
            );
        }

    }

    async getProfileByNo(profileNo) {
    // Адреса AdsPower API для отримання списку профілів
    const url = `${this.apiUrl}/api/v2/browser-profile/list`;

    // AdsPower очікує номери профілів у вигляді масиву
    const data = {
        profile_no: [String(profileNo)],
        page: "1",
        limit: "1",
    };

    // Налаштування HTTP-запиту
    const config = {
        headers: this.headers,
        timeout: 60000,
    };

    try {
        // Надсилаємо запит в AdsPower
        const response = await axios.post(url, data, config);

        // Отримуємо основну відповідь AdsPower
        const result = response.data;

        // code !== 0 означає помилку AdsPower API
        if (result.code !== 0) {
            throw new Error(result.msg);
        }

        // Беремо перший знайдений профіль
        const profile = result.data?.list?.[0];

        // Якщо список порожній, профіль не знайдено
        if (!profile) {
            throw new Error(
                `Профіль із номером ${profileNo} не знайдений`
            );
        }

        // Повертаємо весь об'єкт профілю
        return profile;

    } catch (error) {
        // Беремо текст помилки Axios або звичайної помилки JavaScript
        const message =
            error.response?.data?.msg ||
            error.message ||
            "Невідома помилка";

        throw new Error(
            `Не вдалося отримати профіль ${profileNo}: ${message}`
        );
    }





    
}





}


export default AdsPower;