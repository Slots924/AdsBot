import axios from "axios";

import createProxyAgent from "./createProxyAgent.js";


export default async function checkProxy(
    proxy,
    { timeout = 15000 } = {}
) {
    /*
        proxy приходить сюди вже в нашому форматі:

        {
            type: "socks5",
            host: "127.0.0.1",
            port: "8000",
            username: "login",
            password: "password"
        }
    */

    const proxyAgent = createProxyAgent(proxy);


    // Запам'ятовуємо час початку перевірки
    const startedAt = Date.now();


    try {
        /*
            Робимо реальний запит через проксі.

            Ipify поверне зовнішню IP-адресу,
            з якої прийшов наш запит.
        */
        const response = await axios.get(
            "https://api.ipify.org?format=json",
            {
                // Вказуємо агент, через який піде HTTPS-запит
                httpsAgent: proxyAgent,

                // Вимикаємо стандартну проксі-логіку Axios
                proxy: false,

                // Час перевірки можна налаштувати для конкретного сценарію
                timeout,
            }
        );


        // Проксі успішно виконала запит
        return {
            working: true,
            ip: response.data.ip,
            responseTime: Date.now() - startedAt,
        };

    } catch (error) {
        // Проксі не змогла виконати запит
        return {
            working: false,
            error: error.message,
            responseTime: Date.now() - startedAt,
        };
    }
}
