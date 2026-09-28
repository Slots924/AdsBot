import { useEffect, useMemo, useState } from "react";
import {
    BadgeDollarSign,
    Bot,
    BriefcaseBusiness,
    Check,
    Copy,
    CreditCard,
    LoaderCircle,
    LogOut,
    PanelsTopLeft,
    Phone,
    Play,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    UserRoundCog,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";


const defaultTargetUserId = "61594188892743";
const defaultCategoryId = "802560142464893";
const defaultBusiness = {
    street1: "1600 Pennsylvania Avenue NW",
    street2: "",
    city: "Washington",
    state: "DC",
    zip: "20500",
    countryCode: "US",
    businessName: "",
    currency: "USD",
    timezone: "Europe/Kiev",
};

const dialingCountryCodes = Object.freeze({
    1: "US", 7: "RU", 31: "NL", 33: "FR", 34: "ES", 36: "HU", 39: "IT",
    40: "RO", 44: "GB", 48: "PL", 49: "DE", 52: "MX", 55: "BR", 61: "AU",
    62: "ID", 63: "PH", 65: "SG", 66: "TH", 81: "JP", 82: "KR", 84: "VN",
    86: "CN", 90: "TR", 91: "IN", 380: "UA", 420: "CZ", 421: "SK", 971: "AE",
    972: "IL",
});


function normalizeDialingCode(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits ? `+${digits}` : "";
}


const sections = [
    ["launch", "Запуск", Play],
    ["fanpage", "Фанпейдж", PanelsTopLeft],
    ["business", "Ads Manager", BriefcaseBusiness],
    ["payment", "Спосіб оплати", CreditCard],
    ["phone", "Телефон", Phone],
    ["pixels", "Пікселі", Sparkles],
    ["api", "API-профіль", Bot],
];


function AccountSelect({ accounts, value, onChange, disabled = false }) {
    return <label className="field"><span>Рекламний кабінет</span><select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Оберіть РК</option>{accounts.map((account) => <option key={account.id} value={account.accountId || account.id}>{account.accountStatus === 1 ? "●" : "○"} {account.name} · {account.id} · {account.currency || "—"}</option>)}</select></label>;
}


function SuccessNotice({ children }) {
    return <div className="personal-success personal-action-success"><ShieldCheck size={18} />{children}</div>;
}


export default function PersonalAccountModal({ profile, onClose, onError = () => {}, showToast }) {
    const [section, setSection] = useState("launch");
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState("");
    const [completed, setCompleted] = useState(new Set());
    const [accounts, setAccounts] = useState([]);
    const [adAccountId, setAdAccountId] = useState("");
    const [adsManagerReady, setAdsManagerReady] = useState(false);
    const [feedback, setFeedback] = useState({});
    const [cards, setCards] = useState([]);
    const [pixels, setPixels] = useState([]);
    const [fanName, setFanName] = useState("");
    const [manualCategory, setManualCategory] = useState(false);
    const [categoryId, setCategoryId] = useState(defaultCategoryId);
    const [pageId, setPageId] = useState("");
    const [additionalProfileId, setAdditionalProfileId] = useState("");
    const [targetUserId, setTargetUserId] = useState(defaultTargetUserId);
    const [business, setBusiness] = useState(defaultBusiness);
    const [businessEditor, setBusinessEditor] = useState(false);
    const [cardId, setCardId] = useState("");
    const [securityCode, setSecurityCode] = useState("");
    const [phoneDialingCode, setPhoneDialingCode] = useState("+1");
    const [phone, setPhone] = useState("");
    const [phoneCode, setPhoneCode] = useState("");
    const [phoneSent, setPhoneSent] = useState(false);
    const [pixelName, setPixelName] = useState("");
    const [apiName, setApiName] = useState("");
    const activeCard = useMemo(() => cards.find((item) => item.id === cardId), [cards, cardId]);
    const normalizedDialingCode = normalizeDialingCode(phoneDialingCode);
    const dialingDigits = normalizedDialingCode.slice(1);
    const phoneCountryCode = dialingCountryCodes[dialingDigits] ?? "";
    const phoneE164 = `${normalizedDialingCode}${phone}`;
    const hasValidPhone = Boolean(phoneCountryCode)
        && /^\d{6,14}$/.test(phone)
        && phoneE164.length <= 16;

    useEffect(() => {
        unwrap(window.adsBot.getCreditCards()).then(setCards).catch(() => {});
    }, []);

    const mark = (key) => setCompleted((current) => new Set([...current, key]));
    const run = async (key, operation, successMessage, feedbackKey = key) => {
        if (busy) return null;
        setBusy(key);
        try {
            const result = await unwrap(operation());
            if (successMessage) {
                showToast?.(successMessage, "success");
                setFeedback((current) => ({ ...current, [feedbackKey]: successMessage }));
            }
            mark(key);
            return result;
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося виконати дію" });
            return null;
        } finally {
            setBusy("");
        }
    };
    const requireSession = () => {
        if (session) return true;
        showToast?.("Спочатку запустіть профіль", "info");
        setSection("launch");
        return false;
    };
    const refreshAccounts = async () => {
        if (!requireSession()) return;
        const value = await run("accounts", () => window.adsBot.getPersonalAdAccounts(session.id), "Список РК оновлено");
        if (value) {
            setAccounts(value);
            setAdsManagerReady(true);
            if (!adAccountId && value[0]) setAdAccountId(value[0].accountId || value[0].id);
        }
    };
    const initializeAdsManager = async () => {
        if (!requireSession()) return;
        const value = await run(
            "business",
            () => window.adsBot.getPersonalAdAccounts(session.id),
            "Ads Manager ініціалізовано, список РК отримано",
            "business.initialize"
        );
        if (!value) return;
        setAccounts(value);
        setAdsManagerReady(true);
        if (!adAccountId && value[0]) setAdAccountId(value[0].accountId || value[0].id);
    };
    const close = async (closeProfile = false) => {
        if (busy) return;
        if (session) {
            setBusy("close");
            try {
                await unwrap(closeProfile
                    ? window.adsBot.closePersonalAccountProfile(session.id)
                    : window.adsBot.disconnectPersonalAccountSession(session.id));
            } catch (error) {
                onError({ ...errorDetails(error), title: "Не вдалося завершити browser-сесію" });
                setBusy("");
                return;
            }
        }
        onClose();
    };

    return <div className="overlay personal-account-layer" onMouseDown={() => void close(false)}>
        <div className="personal-account-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header className="personal-account-header">
                <div className="personal-account-title"><span className="personal-account-icon"><UserRoundCog size={22} /></span><div><span className="eyebrow">AdsPower №{profile.profileNo}</span><h2>Персональний акаунт</h2></div></div>
                <div className="personal-account-session-state"><span className={session ? "online" : ""}><i /> {session ? "Puppeteer підключено" : "Профіль не запущено"}</span>{session && <small>{session.context} · actor {session.actorId || "—"}</small>}</div>
                <button type="button" className="icon-button" disabled={Boolean(busy)} onClick={() => void close(false)}><X size={18} /></button>
            </header>
            <div className="personal-account-layout">
                <nav className="personal-account-nav">{sections.map(([key, title, Icon], index) => <button type="button" className={section === key ? "active" : ""} key={key} onClick={() => setSection(key)}><span>{completed.has(key) ? <Check size={15} /> : index + 1}</span><Icon size={16} /> {title}</button>)}</nav>
                <main className="personal-account-body">
                    {section === "launch" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Крок 1</span><h3>Запуск і перевірка профілю</h3><p>AdsPower, Facebook login, active state, English та актуальний GraphQL payload.</p></div></div>
                        <div className="personal-profile-card"><div><strong>{profile.name || "Без назви"}</strong><small>AdsPower №{profile.profileNo} · {profile.groupName || "Без групи"}</small></div><div className="personal-tags">{profile.tags?.map((tag) => <span key={tag.id || tag.name}>{tag.name}</span>)}</div></div>
                        {!session ? <button type="button" className="primary-button personal-main-action" disabled={Boolean(busy)} onClick={async () => { const value = await run("launch", () => window.adsBot.startPersonalAccountSession(profile.profileNo), "Профіль готовий до роботи"); if (value) setSession(value); }}><Play size={16} /> Запустити і перевірити</button> : <div className="personal-success"><ShieldCheck size={20} /> Профіль готовий. Browser залишатиметься відкритим до завершення сесії.</div>}
                    </section>}

                    {section === "fanpage" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Facebook</span><h3>Фанпейдж</h3><p>Перед кожною дією програма перевіряє actor і отримує свіжий payload.</p></div></div>
                        <div className="personal-action-card"><h4>Створення фанпейджа</h4><label className="field"><span>Назва</span><input value={fanName} onChange={(event) => setFanName(event.target.value)} /></label><label className="checkbox-line"><input type="checkbox" checked={manualCategory} onChange={(event) => setManualCategory(event.target.checked)} /><span><strong>Ввести ID категорії вручну</strong><small>Стандартне значення: {defaultCategoryId}</small></span></label><label className="field"><span>Category ID</span><input disabled={!manualCategory} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} /></label><button type="button" className="primary-button" disabled={!fanName.trim() || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const value = await run("fanpage", () => window.adsBot.createPersonalFanPage(session.id, { name: fanName, categoryId: manualCategory ? categoryId : "" }), "Фанпейдж успішно створено", "fanpage.create"); if (value) { setPageId(value.pageId); setAdditionalProfileId(value.additionalProfileId); setSession(value.session); } }}><PanelsTopLeft size={16} /> Створити фанпейдж</button>{feedback["fanpage.create"] && <SuccessNotice>{feedback["fanpage.create"]}</SuccessNotice>}</div>
                        <div className="personal-action-card"><h4>Перемикання на фанпейдж</h4><div className="personal-two-columns"><label className="field"><span>Page ID · Graph API</span><input value={pageId} onChange={(event) => setPageId(event.target.value)} /></label><label className="field"><span>Additional profile ID</span><input value={additionalProfileId} onChange={(event) => setAdditionalProfileId(event.target.value)} /></label></div><button type="button" className="secondary-button" disabled={!additionalProfileId || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const value = await run("fanpage", () => window.adsBot.switchPersonalFanPage(session.id, { additionalProfileId }), "Запит на перемикання на фанпейдж прийнято Facebook", "fanpage.switch"); if (value?.session) setSession(value.session); }}>Перемкнутися на фанпейдж</button>{feedback["fanpage.switch"] && <SuccessNotice>{feedback["fanpage.switch"]}</SuccessNotice>}</div>
                        <div className="personal-action-card"><h4>Надати Full Access</h4><div className="personal-two-columns"><label className="field"><span>Additional profile ID</span><input value={additionalProfileId} onChange={(event) => setAdditionalProfileId(event.target.value)} /></label><label className="field"><span>ID користувача</span><input value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} /></label></div><p className="personal-note">Відкриється Profile access, буде отримано новий payload і за потреби підтверджено пароль із AdsPower.</p><button type="button" className="primary-button" disabled={!additionalProfileId || !targetUserId || Boolean(busy)} onClick={() => requireSession() && run("fanpage", () => window.adsBot.grantPersonalFanPageAccess(session.id, { additionalProfileId, targetUserId }), "Запит на Full Access відправлено", "fanpage.access")}>Надати доступ</button>{feedback["fanpage.access"] && <SuccessNotice>{feedback["fanpage.access"]}</SuccessNotice>}</div>
                    </section>}

                    {section === "business" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Ads Manager</span><h3>Рекламний кабінет і business info</h3><p>Спершу ініціалізуйте Ads Manager: програма отримає свіжі payload, token і список РК.</p></div>{adsManagerReady && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw className={busy === "accounts" ? "spin" : ""} size={16} /> Оновити РК</button>}</div>
                        {!adsManagerReady ? <div className="personal-action-card"><h4>Ініціалізація Ads Manager</h4><p className="personal-note">Перехід у Ads Manager, отримання payload і token, після чого список доступних РК завантажиться автоматично.</p><button type="button" className="primary-button personal-main-action" disabled={Boolean(busy)} onClick={initializeAdsManager}><BriefcaseBusiness size={16} /> Ініціалізувати Ads Manager</button>{feedback["business.initialize"] && <SuccessNotice>{feedback["business.initialize"]}</SuccessNotice>}</div> : <><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} />
                        <div className="personal-inline-actions"><button type="button" className="secondary-button" disabled={!adAccountId || Boolean(busy)} onClick={() => requireSession() && run("business", () => window.adsBot.checkPersonalBusinessInfo(session.id, { adAccountId }), "Business info перевірено", "business.check")}>Перевірити business info</button><button type="button" className="primary-button" disabled={!adAccountId || Boolean(busy)} onClick={() => setBusinessEditor(true)}><BriefcaseBusiness size={16} /> Оновити business info</button></div>{feedback["business.check"] && <SuccessNotice>{feedback["business.check"]}</SuccessNotice>}
                        {businessEditor && <div className="personal-action-card business-editor"><div className="personal-card-heading"><h4>Business information</h4><button type="button" className="icon-button" onClick={() => setBusinessEditor(false)}><X size={15} /></button></div><div className="personal-two-columns">{[["street1", "Адреса"], ["street2", "Адреса 2"], ["city", "Місто"], ["state", "Штат"], ["zip", "ZIP"], ["countryCode", "Країна"], ["businessName", "Назва бізнесу"], ["currency", "Валюта"], ["timezone", "Timezone"]].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input value={business[key]} onChange={(event) => setBusiness({ ...business, [key]: event.target.value })} /></label>)}</div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setBusinessEditor(false)}>Назад</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={async () => { const value = await run("business", () => window.adsBot.updatePersonalBusinessInfo(session.id, { adAccountId, currency: business.currency, timezone: business.timezone, tax: { businessName: business.businessName, businessAddress: business } }), "Business info успішно оновлено", "business.update"); if (value) setBusinessEditor(false); }}>Підтвердити</button></div>{feedback["business.update"] && <SuccessNotice>{feedback["business.update"]}</SuccessNotice>}</div>}</>}
                    </section>}

                    {section === "payment" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Billing</span><h3>Додати спосіб оплати</h3><p>Карта читається із зашифрованого локального сховища; CVC не зберігається.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button></div><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} /><label className="field"><span>Кредитна картка</span><select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Оберіть картку</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname.toUpperCase()} · {card.cardholderName} · {card.network} {card.last4} · {card.expiration}</option>)}</select></label>{activeCard && <div className="selected-card-summary"><strong>{activeCard.nickname.toUpperCase()}</strong><small>{activeCard.cardholderName} · {activeCard.network} •••• {activeCard.last4} · EXP {activeCard.expiration}{activeCard.postalCode ? ` · ZIP ${activeCard.postalCode}` : ""}</small></div>}<label className="field compact-field"><span>CVC · не зберігається</span><input type="password" inputMode="numeric" maxLength="4" value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, ""))} /></label><button type="button" className="primary-button personal-main-action" disabled={!adAccountId || !cardId || !/^\d{3,4}$/.test(securityCode) || Boolean(busy)} onClick={async () => { const value = await run("payment", () => window.adsBot.addPersonalCreditCard(session.id, { adAccountId, cardId, securityCode }), "Спосіб оплати успішно додано", "payment.add"); if (value) setSecurityCode(""); }}><BadgeDollarSign size={16} /> Додати карту</button>{feedback["payment.add"] && <SuccessNotice>{feedback["payment.add"]}</SuccessNotice>}</section>}

                    {section === "phone" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Verification</span><h3>Підтвердження номера телефону</h3><p>Код країни можна вводити як з плюсом, так і без нього; Facebook отримає нормалізований E.164 номер.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button></div><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} /><div className="phone-verification-row"><label className="field country"><span>Код країни</span><input inputMode="numeric" placeholder="+1" value={phoneDialingCode} onChange={(event) => { setPhoneDialingCode(event.target.value); setPhoneSent(false); setPhoneCode(""); }} /></label><label className="field"><span>Номер телефону</span><input inputMode="numeric" placeholder="2025550123" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "").slice(0, 14)); setPhoneSent(false); setPhoneCode(""); }} /></label><button type="button" className="secondary-button" disabled={!adAccountId || !hasValidPhone || Boolean(busy)} onClick={async () => { const value = await run("phone", () => window.adsBot.requestPersonalPhoneCode(session.id, { adAccountId, phoneE164, countryCode: phoneCountryCode, locale: "en_US" }), "Facebook прийняв запит і надіслав код", "phone.sent"); setPhoneSent(Boolean(value)); }}>Надіслати код</button><label className="field"><span>Код підтвердження</span><input disabled={!phoneSent} inputMode="numeric" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ""))} /></label><button type="button" className="primary-button" disabled={!phoneSent || !/^\d{4,8}$/.test(phoneCode) || Boolean(busy)} onClick={async () => { const value = await run("phone", () => window.adsBot.submitPersonalPhoneCode(session.id, { code: phoneCode }), "Код прийнято, номер телефону підтверджено", "phone.verified"); if (value) { setPhoneSent(false); setPhoneCode(""); } }}>Підтвердити</button></div><p className="personal-note">{phoneCountryCode ? `Facebook отримає ${phoneE164} · країна ${phoneCountryCode}.` : "Для цього коду країни ще немає ISO-відповідника."}</p>{feedback["phone.sent"] && <SuccessNotice>{feedback["phone.sent"]}</SuccessNotice>}{feedback["phone.verified"] && <SuccessNotice>{feedback["phone.verified"]}</SuccessNotice>}</section>}

                    {section === "pixels" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Events Manager</span><h3>Пікселі</h3></div><div className="personal-inline-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button><button type="button" className="secondary-button" disabled={!adAccountId || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const value = await run("pixels", () => window.adsBot.getPersonalPixels(session.id, adAccountId), "Пікселі оновлено", "pixels.list"); if (value) setPixels(value); }}><RefreshCw size={16} /> Оновити пікселі</button></div></div><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} /><div className="personal-create-row"><label className="field"><span>Назва нового пікселя</span><input value={pixelName} onChange={(event) => setPixelName(event.target.value)} /></label><button type="button" className="primary-button" disabled={!adAccountId || !pixelName.trim() || Boolean(busy)} onClick={async () => { const value = await run("pixels", () => window.adsBot.createPersonalPixel(session.id, { adAccountId, name: pixelName }), "Піксель успішно створено", "pixels.create"); if (value) { setPixelName(""); const list = await run("pixels", () => window.adsBot.getPersonalPixels(session.id, adAccountId)); if (list) setPixels(list); } }}>Створити піксель</button></div>{feedback["pixels.create"] && <SuccessNotice>{feedback["pixels.create"]}</SuccessNotice>}<div className="personal-resource-list">{pixels.map((pixel) => <div key={pixel.id}><span><strong>{pixel.name}</strong><small>{pixel.id}</small></span><button type="button" className="icon-button" title="Копіювати" onClick={() => navigator.clipboard.writeText(`${pixel.name} · ${pixel.id}`)}><Copy size={15} /></button></div>)}{!pixels.length && <div className="select-empty">Натисніть «Оновити пікселі».</div>}</div></section>}

                    {section === "api" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Фінальний крок</span><h3>Створити API-профіль</h3><p>Cookies, User-Agent і token беруться з поточної Ads Manager сесії.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button></div><label className="field"><span>Назва</span><input value={apiName} onChange={(event) => setApiName(event.target.value)} /></label><label className="field"><span>Карта в назві · необов’язково</span><select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Без карти</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname.toUpperCase()} · {card.last4}</option>)}</select></label><div className="api-name-preview"><small>Назва API-клієнта</small><strong>{apiName.trim() || "Назва"}{activeCard ? ` (${activeCard.nickname} ${activeCard.last4})` : ""}</strong></div><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} /><button type="button" className="primary-button personal-main-action" disabled={!apiName.trim() || !adAccountId || Boolean(busy)} onClick={() => requireSession() && run("api", () => window.adsBot.createPersonalApiProfile(session.id, { name: apiName, cardId, adAccountId }), "API-профіль створено")}><Bot size={16} /> Створити API-профіль</button></section>}
                </main>
            </div>
            <footer className="personal-account-footer"><div>{busy && <span><LoaderCircle className="spin" size={15} /> Виконується дія…</span>}{session?.reportPath && <small>Детальний звіт створюється автоматично</small>}</div><div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void close(false)}><LogOut size={16} /> Відключити Puppeteer</button><button type="button" className="danger-button" disabled={!session || Boolean(busy)} onClick={() => void close(true)}>Закрити профіль</button></div></footer>
        </div>
    </div>;
}
