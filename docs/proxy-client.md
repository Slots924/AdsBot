# Proxy client

`ProxyHttpClient` виконує HTTP-запити через спільний пул проксі. Він використовується Facebook Graph API, але не залежить від Facebook і може бути повторно використаний іншими сервісами.

## Конфігурація

Реальний пул зберігається в `data/facebookApi/proxies.json`:

```json
{
  "proxies": [
    {
      "id": "proxy-001",
      "adsPowerId": 14,
      "name": "Київ",
      "type": "socks5",
      "host": "proxy.example.com",
      "port": "10000",
      "username": "REPLACE_WITH_USERNAME",
      "password": "REPLACE_WITH_PASSWORD",
      "refreshUrl": "https://provider.example/changeip/token"
    }
  ]
}
```

Підтримуються `socks5`, `http`, `https` та `no_proxy`. Для робочої проксі `id`, `type`, `host` і `port` обов'язкові; `adsPowerId`, `name`, `username`, `password` і `refreshUrl` необов'язкові. `id` унікальний і створюється автоматично. `name` може повторюватися. `adsPowerId` якщо вказаний має бути цілим числом. Записи `no_proxy` не потрапляють у пул Graph API.

У формі GUI можна вставити рядок AdsPower на кшталт `socks5://host:port:login:password[https://provider.example/changeip/token]`. Кнопка «ОК» розбирає його в окремі поля.

`refreshUrl` — пряме посилання провайдера на зміну IP, як `proxy_url` в AdsPower. GUI надсилає GET на це посилання і чекає, поки проксі знову відповість, не довше 90 секунд. Під час коментування очікування після рефрешу обмежене 60 секундами. Логін, пароль і `refreshUrl` у renderer не повертаються.

Порядок записів у `proxies.json` можна змінювати перетягуванням карток. Graph API за замовчуванням бере найвищу проксі в списку, крім `no_proxy`. Failover далі йде вниз по цьому ж порядку.

## Алгоритм failover

1. Перший запит одразу йде через першу проксі без health check.
2. Connection/DNS/socket/TLS/timeout або HTTP 407 запускає failover.
3. Наступні проксі послідовно перевіряються через `checkProxy` з timeout 5 секунд.
4. Перша робоча проксі стає активною для всіх клієнтів.
5. Початковий HTTP-запит повторюється один раз, якщо викликач не вимкнув retry.
6. Якщо альтернатив немає, повертається Error з `code="PROXY_POOL_EXHAUSTED"`.

HTTP-відповіді цільового API 400, 401, 403, 429 і 5xx не вважаються проблемою проксі. Якщо повторний запит також падає, третьої спроби немає.

Паралельні помилки використовують один `failoverPromise`: лише перший запит перевіряє пул, інші очікують його результат або використовують уже перемкнену проксі.

## Пряме використання

```js
import ProxyHttpClient from "./services/proxy/ProxyHttpClient.js";

const proxyClient = new ProxyHttpClient({
    proxies: [
        {
            id: "proxy-001",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            username: "REPLACE_WITH_USERNAME",
            password: "REPLACE_WITH_PASSWORD",
        },
    ],
});

const response = await proxyClient.get(
    "https://api.example.com/status",
    {
        headers: {
            Accept: "application/json",
        },
        timeout: 30000,
    }
);
```

Для POST та інших методів доступний універсальний
`request(config, options)`. Передані викликачем `httpAgent`, `httpsAgent` і
стандартна Axios proxy-конфігурація завжди замінюються агентом активної проксі.

Для запитів, які не можна безпечно дублювати, retry вимикається:

```js
await proxyClient.request(postConfig, {
    retryOnConnectionError: false,
});
```

Після connection error клієнт перемикає активну проксі для майбутніх запитів,
але не повторює поточний POST і повертає
`code="PROXY_REQUEST_OUTCOME_UNKNOWN"`.

## Безпека

Proxy client не логує повну адресу проксі, username або password. Помилка вичерпання пулу також не містить credentials. Реальний конфіг ігнорується Git; у прикладах і документації потрібно використовувати лише несправжні значення.
