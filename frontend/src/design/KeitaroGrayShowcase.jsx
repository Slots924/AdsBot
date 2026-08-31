import { useState } from "react";
import { Archive, Check, Plus, Save, Trash2 } from "lucide-react";
import {
    GrayAssetRow,
    GrayButton,
    GrayCard,
    GrayField,
    GrayInput,
    GrayModal,
    GraySearch,
    GraySelect,
    GrayTextarea,
} from "../components/gray-ui/index.js";
import "../styles/keitaro-gray-showcase.css";

const groups = [
    { id: "all", name: "Усі" },
    { id: "admin", name: "📌 W [Admin]" },
    { id: "archive", name: "🗄 Archive" },
];

const swatches = [
    ["Фон", "#1B1B1B", "var(--kg-bg)"],
    ["Панель", "#202020", "var(--kg-surface)"],
    ["Картка", "#242424", "var(--kg-surface-raised)"],
    ["Поле", "#252525", "var(--kg-control)"],
    ["Межа", "#414141", "var(--kg-border)"],
    ["Текст", "#EEEEEE", "var(--kg-text)"],
    ["Другорядний", "#929292", "var(--kg-text-muted)"],
    ["Фокус", "#6CB5F2", "var(--kg-focus)"],
];

export default function KeitaroGrayShowcase() {
    const [search, setSearch] = useState("");
    const [group, setGroup] = useState("archive");
    const [enabled, setEnabled] = useState(true);
    const [share, setShare] = useState(100);

    return <main className="kg-theme kg-showcase">
        <header className="kg-showcase-hero">
            <div><span className="kg-showcase-kicker">AdsBot design system</span><h1>Keitaro Gray UI</h1><p>Плоский темно-сірий інтерфейс для робочих екранів, форм, списків і модальних вікон. Еталон — вкладка «Шаблони потоків».</p></div>
            <span className="kg-showcase-version"><Check size={15} /> Канонічний стиль</span>
        </header>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Кольори</h2><p>Нейтральні поверхні утворюють ієрархію. Колір використовується тільки для дій і станів.</p></div><div className="kg-swatches">{swatches.map(([name, hex, value]) => <div className="kg-swatch" key={name}><i style={{ background: value }} /><strong>{name}</strong><code>{hex}</code></div>)}</div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Типографіка</h2><p>Segoe UI Variable, компактні розміри та чітка різниця між основним і допоміжним текстом.</p></div><div className="kg-type-grid"><div><span>Заголовок сторінки · 29 px</span><h1>Шаблони потоків</h1></div><div><span>Заголовок панелі · 20 px</span><h2>Налаштування шаблону</h2></div><div><span>Основний текст · 14 px</span><p>Назва, яка з’явиться у Keitaro</p></div><div><span>Допоміжний текст · 12 px</span><small>ID 1399 · група Archive</small></div></div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Поля та меню</h2><p>Висота контролів 40 px, межа 1 px, радіус 6–7 px. Відкрите меню завжди розташоване поверх списків.</p></div><div className="kg-control-grid"><GrayField label="Назва шаблону" help="Коротка зрозуміла назва без декоративного тексту."><GrayInput defaultValue="US(es) OFFERS" /></GrayField><GrayField label="Пошук"><GraySearch value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук оферів за назвою…" /></GrayField><GrayField label="Група"><GraySelect items={groups} value={group} onChange={setGroup} ariaLabel="Група оферів" /></GrayField><GrayField label="Коментар"><GrayTextarea defaultValue="Службова примітка до шаблону" /></GrayField></div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Кнопки та стани</h2><p>Основна кнопка одна на контекст. Сірі кнопки — другорядні, червоні — лише для небезпечних дій.</p></div><div className="kg-button-row"><GrayButton variant="primary"><Save size={16} /> Зберегти</GrayButton><GrayButton><Plus size={16} /> Додати офери</GrayButton><GrayButton><Archive size={16} /> Архівувати</GrayButton><GrayButton variant="danger"><Trash2 size={16} /> Видалити</GrayButton><GrayButton disabled>Недоступно</GrayButton></div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Робочі картки</h2><p>Картки не мають градієнтів. Назва завжди помітніша за ID та іншу технічну інформацію.</p></div><div className="kg-showcase-stack"><GrayAssetRow name="US | ES [GentleFlirt] | LP1 ES | 4.8$ | 20" meta="ID 1779 · група 213" share={share} enabled={enabled} onShareChange={setShare} onEnabledChange={setEnabled} onRemove={() => {}} /><div className="kg-empty">Нічого не додано</div></div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Панелі</h2><p>Заголовок відділяється тонкою межею, а вміст має рівномірні внутрішні відступи.</p></div><div className="kg-showcase-cards"><GrayCard title="Основні налаштування" description="Групуйте тільки пов’язані поля."><GrayField label="Назва потоку"><GrayInput defaultValue="US(es) OFFERS" /></GrayField></GrayCard><GrayCard title="Стан шаблону" description="Функціональний колір пояснює стан, а не прикрашає екран."><div className="kg-status-list"><span className="success">Активний</span><span className="danger">Помилка</span><span>Неактивний</span></div></GrayCard></div></section>

        <section className="kg-showcase-section"><div className="kg-showcase-section-head"><h2>Модальне вікно</h2><p>Приклад вибору кількох оферів. Меню групи навмисно відкрите, щоб зафіксувати правильне перекриття шарів.</p></div><GrayModal preview title="Додати офери" description="Натискайте «+», щоб додати кілька елементів. Повторне натискання прибирає елемент." onClose={() => {}}><div className="kg-modal-toolbar"><GrayField label="Пошук"><GraySearch value="" onChange={() => {}} placeholder="Пошук оферів за назвою…" /></GrayField><GrayField label="Група"><GraySelect items={groups} value="archive" onChange={() => {}} ariaLabel="Група у прикладі" defaultOpen /></GrayField></div><div className="kg-picker-list"><button type="button"><span><strong>AU | [TransGenderSpot] | 100437 | unlimited</strong><small>ID 1399</small></span><Plus size={18} /></button><button type="button"><span><strong>HU | [Mikistitunk] | Mature | 1.04€ | 100</strong><small>ID 1381</small></span><Plus size={18} /></button></div></GrayModal></section>
    </main>;
}
