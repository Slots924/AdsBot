# CommentAccountProfileData — дані профілів для коментарних акаунтів Facebook

## Для чого цей клас

Клас керує всіма даними для створення "персон" коментарних акаунтів:
- імена + прізвища (чоловічі та жіночі)
- компанії
- професії
- університети / навчальні заклади

Він працює з цільовим гео (US, DE, UK, UA тощо).

Головна ідея:
- Дані зберігаються локально у файлах.
- При першому запиті для нового гео — автоматично генеруємо дані через Grok.
- При кожному запиті беремо перші N записів, використовуємо їх і переміщуємо в кінець списку (ротація).
- Завдяки цьому одні й ті самі дані не повторюються одразу, а поступово "крутяться".

## Де знаходиться клас

`services/profiles/CommentAccountProfileData.js`

## Основний метод

```js
import CommentAccountProfileData from "./services/profiles/CommentAccountProfileData.js";

const provider = new CommentAccountProfileData();

const result = await provider.getCommentAccountProfiles({
    geo: "US",          // двобуквений код
    maleCount: 5,       // скільки чоловічих
    femaleCount: 5,     // скільки жіночих
});

console.log(result);
/*
{
  geo: "US",
  profiles: [
    {
      firstName: "Daryl",
      lastName: "Hargrove",
      gender: "male",
      company: "Prairie Auto Repair",
      profession: "Mechanic",
      university: "Northridge Community College"
    },
    ...
  ]
}
*/
```

Повертає об'єкт з полями:
- `geo` — код країни
- `profiles` — масив профілів

Кожен профіль містить:
- `firstName` — ім'я
- `lastName` — прізвище
- `gender` — "male" або "female"
- `company` — назва компанії
- `profession` — професія
- `university` — навчальний заклад

## Як працює генерація даних (якщо файлів ще немає)

1. **Імена**
   - Чоловічі: 200 штук у `data/generated-profiles-data/names/man/US.json`
   - Жіночі: 200 штук у `data/generated-profiles-data/names/woman/US.json`
   - Промпт: `data/prompts/grok/generate-names.txt`
   - Правила в промпті:
     - Уникаємо найпопулярніших імен і прізвищ
     - СУВОРО не беремо топ-200 прізвищ країни
     - Реалістичні, не знаменитості

2. **Компанії**
   - 50 штук у `data/generated-profiles-data/companies/US.json`
   - Промпт: `data/prompts/grok/generate-companies.txt`
   - Для генерації увімкнено web_search (доступ до інтернету).
   - Правила:
     - Grok шукає в інтернеті реально існуючі середні та дрібні локальні компанії
     - Жодних світових брендів (Google, Nike, Amazon, BMW...)
     - Без ТОВ / LLC / GmbH / Ltd у назві — просто чиста назва
     - Приклади стилю для UA (з існуючих даних):
       - Enran
       - Ivales Mebli
       - Hardy
       - Український Корпоративний Одяг
       - Morning Star

3. **Університети / коледжі**
   - 50 штук у `data/generated-profiles-data/universities/US.json`
   - Промпт: `data/prompts/grok/generate-universities.txt`
   - Для генерації увімкнено web_search (доступ до інтернету).
   - Не топові (не Harvard, не Oxford). Звичайні місцеві коледжі та технікуми (Grok шукає реальні в інтернеті).

4. **Професії**
   - Базовий список: `data/generated-profiles-data/professions/professions.json` (українською)
   - Для кожного гео створюється свій переклад: `professions/US.json`
   - Промпт: `data/prompts/grok/translate-professions.txt`
   - Для UA використовуємо оригінал без перекладу.

Генерація відбувається **тільки один раз** для кожного гео. Потім дані просто крутяться.

## Ротація даних

Після кожного запиту:
- Беремо перші N записів зі списку
- Використовуємо їх для профілів
- Переміщуємо ці N записів у кінець списку
- Зберігаємо оновлений список у файл

Наступного разу візьмемо вже наступні записи.

Це дає постійну ротацію без повторів у межах одного великого списку.

## Ручний тест для США

Файл: `scripts/manual/test-us-comment-profiles.js`

**Важливо:** перед запуском переконайся, що в корені проєкту є файл `.env` з `XAI_API_KEY=...` (як у всіх інших скриптах з `scripts/manual/`).

Запуск з консолі (тільки вручну!):

```bash
node scripts/manual/test-us-comment-profiles.js
```

Тест просить 5+5 профілів для US і красиво виводить у консоль:

```
=== РУЧНИЙ ТЕСТ ДАНИХ ПРОФІЛІВ ДЛЯ КОМЕНТАРНИХ АКАУНТІВ ===
...
ЧОЛОВІЧІ ПРОФІЛІ (5):
  1. Daryl Hargrove
     Стать:       male
     Компанія:    Prairie Auto Repair
     ...
```

## Структура директорій даних

```
data/generated-profiles-data/
├── names/
│   ├── man/
│   │   ├── UA.json
│   │   └── US.json
│   └── woman/
│       └── US.json
├── companies/
│   ├── UA.json
│   └── US.json
├── universities/
│   ├── UA.json
│   └── US.json
└── professions/
    ├── professions.json   ← базовий український список
    ├── UA.json
    └── US.json
```

## Важливі правила (вшиті в промпти)

- Ніколи не використовувати топ-популярні прізвища.
- Компанії — тільки маленькі та середні, локальні.
- Без брендів і без юридичних форм у назві.
- Університети — не престижні топ-заклади.
- Професії — прості та реалістичні.

## Помилки

Клас кидає помилки з кодами:
- `PROFILE_DATA_VALIDATION_ERROR` — неправильне гео або кількість
- `PROFILE_DATA_FILE_ERROR` — проблеми з читанням файлів
- `PROFILE_DATA_GENERATION_ERROR` — Grok не зміг згенерувати дані

## Приклад використання в коді

```js
const data = await provider.getCommentAccountProfiles({
    geo: "DE",
    maleCount: 3,
    femaleCount: 2,
});

// Тепер можна передати ці дані далі у генератор біо/персон
// або напряму використовувати для створення акаунтів
```

Клас повністю ізольований — вся логіка роботи з файлами та Grok всередині нього.

## Примітка для розробників

- Усі коментарі в коді українською.
- Генерація відбувається лише за відсутності файлів.
- Після генерації дані тільки читаються і переміщуються — це дешево і швидко.
- Якщо потрібно примусово перегенерувати — просто видали відповідні .json файли в data/generated-profiles-data.
