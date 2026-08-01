import axios from "axios";

import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";


export default async function checkProxy(proxy) {
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


    // Кодуємо логін і пароль.
    // Це потрібно, якщо в них є @, :, пробіли або інші символи.
    const username = encodeURIComponent(proxy.username);
    const password = encodeURIComponent(proxy.password);


    // Якщо логіна немає, авторизацію в адресу не додаємо
    const authorization = proxy.username
        ? `${username}:${password}@`
        : "";


    // Створюємо повну адресу проксі
    const proxyUrl =
        `${proxy.type}://${authorization}${proxy.host}:${proxy.port}`;


    // Тут зберігатиметься агент для підключення через проксі
    let proxyAgent;


    // Для SOCKS5 використовуємо SocksProxyAgent
    if (proxy.type === "socks5") {
        proxyAgent = new SocksProxyAgent(proxyUrl);

    // Для HTTP та HTTPS використовуємо HttpsProxyAgent
    } else if (
        proxy.type === "http" ||
        proxy.type === "https"
    ) {
        proxyAgent = new HttpsProxyAgent(proxyUrl);

    } else {
        throw new Error(
            `Тип проксі "${proxy.type}" не підтримується`
        );
    }


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

                // Чекаємо максимум 15 секунд
                timeout: 15000,
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