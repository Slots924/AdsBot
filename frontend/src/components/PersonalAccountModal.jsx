import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BadgeDollarSign,
    Bot,
    BriefcaseBusiness,
    Check,
    Copy,
    CreditCard,
    LoaderCircle,
    LogOut,
    Minus,
    PanelsTopLeft,
    Pencil,
    Phone,
    Play,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    UserRoundCog,
    X,
} from "lucide-react";

import { errorDetails, unwrap } from "../lib/api.js";
import SearchSelect from "./SearchSelect.jsx";
import SmsPoolPanel from "./SmsPoolPanel.jsx";
import PersonalBusinessInfoForm from "./PersonalBusinessInfoForm.jsx";
import PersonalPaymentSources from "./PersonalPaymentSources.jsx";
import PhoneVerificationNotice from "./PhoneVerificationNotice.jsx";
import { addCardAndRefreshSources } from "../lib/personalPaymentSources.js";


const defaultTargetUserId = "61594188892743";
const defaultCategoryId = "802560142464893";
const defaultBusiness = {
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    countryCode: "",
    businessName: "",
    currency: "",
    timezone: "",
};

const dialingCountryCodes = Object.freeze({
    1: "US", 7: "RU", 31: "NL", 33: "FR", 34: "ES", 36: "HU", 39: "IT",
    40: "RO", 44: "GB", 48: "PL", 49: "DE", 52: "MX", 55: "BR", 61: "AU",
    62: "ID", 63: "PH", 65: "SG", 66: "TH", 81: "JP", 82: "KR", 84: "VN",
    86: "CN", 90: "TR", 91: "IN", 380: "UA", 420: "CZ", 421: "SK", 971: "AE",
    972: "IL",
});

const phoneVerificationMethods = Object.freeze([
    { value: "SMS", label: "SMS" },
    { value: "WHATSAPP_MESSAGE", label: "WhatsApp" },
    { value: "ROBOCALL", label: "Дзвінок" },
]);


function normalizeDialingCode(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits ? `+${digits}` : "";
}


const sections = [
    ["launch", "Огляд", Play],
    ["fanpage", "Фанпейдж", PanelsTopLeft],
    ["business", "Бізнес інфа", BriefcaseBusiness],
    ["payment", "Спосіб оплати", CreditCard],
    ["phone", "Телефон", Phone],
    ["pixels", "Пікселі", Sparkles],
    ["api", "API-профіль", Bot],
    ["bm", "Бізнесменеджер", BriefcaseBusiness],
];


function AccountSelect({ accounts, value, onChange, disabled = false }) {
    return <SearchSelect items={accounts} value={value} onChange={onChange} disabled={disabled}
        getId={(item) => item.accountId || item.id} getTitle={(item) => item.name || "РК без назви"}
        getSubtitle={(item) => `ID РК: ${item.accountId || item.id}`}
        getSearchText={(item) => `${item.name} ${item.accountId || item.id}`}
        getStatus={(item) => item.accountStatus === 1 ? "active" : "inactive"}
        placeholder="Оберіть РК" searchPlaceholder="Пошук РК…"
        ariaLabel="Рекламний кабінет персонального профілю" className="personal-ad-account-select" />;
}


function SuccessNotice({ children }) {
    return <div className="personal-success personal-action-success"><ShieldCheck size={18} />{children}</div>;
}


export default function PersonalAccountModal({
    profile,
    businessManagers = [],
    initialBmKey = null,
    groups = [],
    onRefreshGroups,
    onProfileChanged,
    onClose,
    onError = () => {},
    showToast,
}) {
    const [activeProfile, setActiveProfile] = useState(profile ?? { profileId: "", profileNo: "", name: "", groupId: "", tags: [] });
    const [profileNoDraft, setProfileNoDraft] = useState(String(profile?.profileNo ?? ""));
    const [businessSession, setBusinessSession] = useState(null);
    const [businessBusy, setBusinessBusy] = useState(false);
    const [availableBusinesses, setAvailableBusinesses] = useState([]);
    const [selectedBusinessId, setSelectedBusinessId] = useState("");
    const [accessRequest, setAccessRequest] = useState(null);
    const [accessState, setAccessState] = useState("");
    const [accessInvites, setAccessInvites] = useState([]);
    const [selectedInviteKey, setSelectedInviteKey] = useState("");
    const [accessError, setAccessError] = useState("");
    const [selectedBmKey, setSelectedBmKey] = useState(initialBmKey ?? businessManagers.find((item) => item.isPrimary)?.accountKey ?? "");
    const [bmSelectionManual, setBmSelectionManual] = useState(Boolean(initialBmKey));
    const [section, setSection] = useState("launch");
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState("");
    const [completed, setCompleted] = useState(new Set());
    const [accounts, setAccounts] = useState([]);
    const [overviewFanPages, setOverviewFanPages] = useState([]);
    const [switchableProfiles, setSwitchableProfiles] = useState([]);
    const [selectedFanPageId, setSelectedFanPageId] = useState("");
    const [fanPageSearch, setFanPageSearch] = useState("");
    const [minimized, setMinimized] = useState(false);
    const [miniPosition, setMiniPosition] = useState({ right: 20, bottom: 20 });
    const dragState = useRef(null);
    const [adAccountId, setAdAccountId] = useState("");
    const [adsManagerReady, setAdsManagerReady] = useState(false);
    const [feedback, setFeedback] = useState({});
    const [profileName, setProfileName] = useState(profile?.name || "");
    const [profileGroupId, setProfileGroupId] = useState(String(profile?.groupId || ""));
    const [editingProfileName, setEditingProfileName] = useState(false);
    const [cards, setCards] = useState([]);
    const [pixels, setPixels] = useState([]);
    const [fanName, setFanName] = useState("");
    const [manualCategory, setManualCategory] = useState(false);
    const [categoryId, setCategoryId] = useState(defaultCategoryId);
    const [targetUserId, setTargetUserId] = useState(defaultTargetUserId);
    const [fanPagePasswordRequest, setFanPagePasswordRequest] = useState(null);
    const [fanPagePassword, setFanPagePassword] = useState("");
    const [business, setBusiness] = useState(defaultBusiness);
    const [businessCheckedFor, setBusinessCheckedFor] = useState("");
    const [businessRefreshError, setBusinessRefreshError] = useState("");
    const [cardId, setCardId] = useState("");
    const [securityCode, setSecurityCode] = useState("");
    const [paymentSources, setPaymentSources] = useState(null);
    const [paymentSourcesError, setPaymentSourcesError] = useState("");
    const [paymentSourcesLoading, setPaymentSourcesLoading] = useState(false);
    const paymentScope = `${session?.id ?? ""}:${adAccountId}`;
    const paymentScopeRef = useRef(paymentScope);
    paymentScopeRef.current = paymentScope;
    const [phoneDialingCode, setPhoneDialingCode] = useState("+1");
    const [phone, setPhone] = useState("");
    const [phoneCode, setPhoneCode] = useState("");
    const [phoneSent, setPhoneSent] = useState(false);
    const [phoneMethod, setPhoneMethod] = useState("SMS");
    const [phoneCheck, setPhoneCheck] = useState(null);
    const [smsPoolDashboard, setSmsPoolDashboard] = useState({
        service: "Facebook / Meta Viewpoints",
        balance: null,
        countries: [],
        history: [],
        job: null,
    });
    const [pixelName, setPixelName] = useState("");
    const [apiName, setApiName] = useState("");
    const selectedBm = businessManagers.find((item) => item.accountKey === selectedBmKey);
    const visibleBusinessSession = selectedBm?.adsPowerProfileNo && String(selectedBm.adsPowerProfileNo) === String(businessSession?.profileNo)
        ? businessSession
        : null;
    const activeCard = useMemo(() => cards.find((item) => item.id === cardId), [cards, cardId]);
    const selectedFanPage = useMemo(
        () => switchableProfiles.find((item) => item.id === selectedFanPageId) ?? null,
        [switchableProfiles, selectedFanPageId]
    );
    const visibleFanPages = useMemo(() => {
        const query = fanPageSearch.trim().toLowerCase();
        if (!query) return switchableProfiles;
        return switchableProfiles.filter((item) => [item.name, item.id]
            .some((value) => String(value ?? "").toLowerCase().includes(query)));
    }, [switchableProfiles, fanPageSearch]);
    const normalizedDialingCode = normalizeDialingCode(phoneDialingCode);
    const dialingDigits = normalizedDialingCode.slice(1);
    const phoneCountryCode = dialingCountryCodes[dialingDigits] ?? "";
    const phoneE164 = `${normalizedDialingCode}${phone}`;
    const hasValidPhone = Boolean(phoneCountryCode)
        && /^\d{6,14}$/.test(phone)
        && phoneE164.length <= 16;

    useEffect(() => {
        setProfileName(activeProfile.name || "");
        setProfileGroupId(String(activeProfile.groupId || ""));
    }, [activeProfile.groupId, activeProfile.name]);

    useEffect(() => {
        if (!bmSelectionManual) {
            setSelectedBmKey(businessManagers.find((item) => item.isPrimary)?.accountKey ?? businessManagers[0]?.accountKey ?? "");
        }
    }, [businessManagers, bmSelectionManual]);

    useEffect(() => {
        setBusiness(defaultBusiness);
        setBusinessCheckedFor("");
        setBusinessRefreshError("");
    }, [adAccountId]);

    useEffect(() => {
        setPaymentSources(null);
        setPaymentSourcesError("");
        setPaymentSourcesLoading(false);
        setFeedback((current) => ({ ...current, "payment.add": "" }));
    }, [adAccountId, session?.id]);

    useEffect(() => {
        setAccessRequest(null);
        setAccessState("");
    }, [selectedBusinessId, adAccountId]);

    useEffect(() => {
        unwrap(window.adsBot.getCreditCards()).then(setCards).catch(() => {});
    }, []);

    useEffect(() => {
        unwrap(window.adsBot.getPersonalSmsPoolDashboard())
            .then(setSmsPoolDashboard)
            .catch(() => {});
    }, []);

    const applySmsPoolOrder = useCallback((job) => {
        const orderPhone = String(job?.order?.phone ?? "");
        if (orderPhone) {
            const dialingCode = String(job?.country?.dialingCode ?? "");
            setPhoneDialingCode(dialingCode ? `+${dialingCode}` : "+");
            setPhone(orderPhone.replace(/^\+/, "").replace(new RegExp(`^${dialingCode}`), ""));
        }
        if (job?.order?.code) {
            setPhoneCode(job.order.code);
            setPhoneSent(true);
        }
    }, []);

    const mark = (key) => setCompleted((current) => new Set([...current, key]));
    const run = async (
        key,
        operation,
        successMessage,
        feedbackKey = key,
        errorTitle = "Не вдалося виконати дію",
        handleError
    ) => {
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
            if (!handleError?.(error)) onError({ ...errorDetails(error), title: errorTitle });
            return null;
        } finally {
            setBusy("");
        }
    };
    const fetchPaymentSources = async (sessionId, accountId) => {
        const scope = `${sessionId}:${accountId}`;
        if (paymentScopeRef.current === scope) {
            setPaymentSourcesLoading(true);
            setPaymentSourcesError("");
        }
        try {
            const result = await unwrap(window.adsBot.checkPersonalPaymentSources(sessionId, { adAccountId: accountId }));
            if (paymentScopeRef.current === scope) setPaymentSources(result);
            return result;
        } catch (error) {
            if (paymentScopeRef.current === scope) setPaymentSourcesError(error.message || "Помилка перевірки");
            throw error;
        } finally {
            if (paymentScopeRef.current === scope) setPaymentSourcesLoading(false);
        }
    };
    const checkPaymentSources = async () => {
        if (!requireSession()) return;
        await run("payment.sources", async () => ({ ok: true, data: await fetchPaymentSources(session.id, adAccountId) }), null, "payment.sources", "Не вдалося перевірити способи оплати");
    };
    const checkPhone = async () => {
        if (!session || !adAccountId || busy) return;
        setPhoneCheck(null);
        const value = await run("phone.check", () => window.adsBot.checkPersonalPhoneVerification(session.id, { adAccountId }),
            null, "phone.check", "Не вдалося перевірити телефон", () => true);
        setPhoneCheck({ sessionId: session.id, adAccountId, phoneStatus: value?.phoneStatus ?? "UNKNOWN", expiresAt: Date.now() + 5000 });
    };
    const addPaymentCard = async () => {
        if (!requireSession()) return;
        const value = await run("payment", async () => ({
            ok: true,
            data: await addCardAndRefreshSources({
                addCard: async () => {
                    const result = await unwrap(window.adsBot.addPersonalCreditCard(session.id, { adAccountId, cardId, securityCode }));
                    setSecurityCode("");
                    return result;
                },
                refreshSources: () => fetchPaymentSources(session.id, adAccountId),
            }),
        }), "Спосіб оплати успішно додано", "payment.add", "Не вдалося додати карту");
        return value;
    };
    const saveProfileName = async () => {
        const name = profileName.trim();
        if (!activeProfile.profileId || !name || name === activeProfile.name || busy) {
            setEditingProfileName(false);
            return;
        }
        const result = await run(
            "profile.name",
            () => window.adsBot.renameAdsPowerProfile(activeProfile.profileId, name),
            "Назву AdsPower-профілю оновлено"
        );
        if (result) {
            setActiveProfile((current) => ({ ...current, name }));
            setEditingProfileName(false);
            await onProfileChanged?.();
        }
    };
    const saveProfileGroup = async () => {
        if (!activeProfile.profileId || !profileGroupId || String(profileGroupId) === String(activeProfile.groupId) || busy) return;
        const result = await run(
            "profile.group",
            () => window.adsBot.moveAdsPowerProfiles([activeProfile.profileId], profileGroupId),
            "Групу AdsPower змінено"
        );
        if (result) {
            setActiveProfile((current) => ({ ...current, groupId: profileGroupId }));
            await onProfileChanged?.();
        }
    };
    const requireSession = () => {
        if (session) return true;
        showToast?.("Спочатку запустіть профіль", "info");
        setSection("launch");
        return false;
    };
    const dismissFanPagePassword = () => {
        setFanPagePassword("");
        setFanPagePasswordRequest(null);
    };
    const grantFanPageAccess = async (password) => {
        if (!requireSession() || busy) return;
        const request = fanPagePasswordRequest ?? { sessionId: session.id, targetUserId };
        const result = await run("fanpage", () => window.adsBot.grantPersonalFanPageAccess(request.sessionId, {
            targetUserId: request.targetUserId,
            ...(password === undefined ? {} : { password }),
        }), "Запит на Full Access відправлено", "fanpage.access", "Не вдалося надати доступ до фанпейджа", (error) => {
            if (error.code !== "FACEBOOK_PASSWORD_REQUIRED") return false;
            setFanPagePasswordRequest({ ...request, message: error.message });
            return true;
        });
        setFanPagePassword("");
        if (result !== null) setFanPagePasswordRequest(null);
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
    const applyOverview = (nextSession) => {
        if (!nextSession) return;
        setSession(nextSession);
        const overview = nextSession.overview;
        if (!overview) return;
        setAccounts(overview.adAccounts ?? []);
        setOverviewFanPages(overview.fanPages ?? []);
        setAdsManagerReady(Boolean(overview.hasAdsManagerPayload));
        if (!adAccountId && overview.adAccounts?.[0]) {
            setAdAccountId(overview.adAccounts[0].accountId || overview.adAccounts[0].id);
        }
    };
    const switchProfile = async () => {
        const nextNo = profileNoDraft.trim();
        if (!/^\d+$/.test(nextNo) || busy) return;
        if (nextNo === String(activeProfile.profileNo)) return;
        setBusy("profile.switch");
        try {
            const value = await unwrap(window.adsBot.switchPersonalAccountProfile(session?.id ?? null, nextNo));
            setSession(null);
            setAccounts([]);
            setOverviewFanPages([]);
            setSwitchableProfiles([]);
            setSelectedFanPageId("");
            setAdAccountId("");
            setAdsManagerReady(false);
            setFeedback({});
            setCompleted(new Set());
            setPixels([]);
            setProfileName(value.profile.name || "");
            setProfileGroupId(String(value.profile.groupId || ""));
            setActiveProfile(value.profile);
            applyOverview(value.session);
            showToast?.(`Відкрито AdsPower №${nextNo}`, "success");
        } catch (error) {
            if (session) {
                try {
                    await unwrap(window.adsBot.getPersonalAccountSession(session.id));
                } catch {
                    setSession(null);
                    setAccounts([]);
                    setOverviewFanPages([]);
                    setSwitchableProfiles([]);
                    setSelectedFanPageId("");
                    setAdAccountId("");
                    setPixels([]);
                    setAdsManagerReady(false);
                    setFeedback({});
                    setCompleted(new Set());
                    setActiveProfile({ profileId: "", profileNo: "", name: "", groupId: "", tags: [] });
                }
            }
            onError({ ...errorDetails(error), title: "Не вдалося змінити AdsPower-профіль" });
        } finally {
            setBusy("");
        }
    };
    const startPersonal = async () => {
        const nextNo = profileNoDraft.trim();
        if (!/^\d+$/.test(nextNo) || busy) return;
        if (nextNo !== String(activeProfile.profileNo)) {
            await switchProfile();
            return;
        }
        setFeedback((current) => ({ ...current, launch: "" }));
        setSession((current) => current ? { ...current, overview: null } : null);
        const value = await run("launch", () => window.adsBot.startPersonalAccountSession(activeProfile.profileNo), "Профіль готовий до роботи");
        applyOverview(value);
    };
    const startBusiness = async () => {
        if (!selectedBmKey || !businessManagers.find((item) => item.accountKey === selectedBmKey)?.adsPowerProfileNo || businessBusy) return;
        setBusinessBusy(true);
        setFeedback((current) => ({ ...current, businessLaunch: "" }));
        setBusinessSession((current) => current ? { ...current, overview: null } : null);
        try {
            const value = await unwrap(window.adsBot.startBusinessManagerSession(selectedBmKey, businessSession?.id ?? null));
            setBusinessSession(value);
            try {
                const businesses = await unwrap(window.adsBot.getAvailableBusinessManagers(value.id));
                setAvailableBusinesses(businesses);
                setSelectedBusinessId((current) => businesses.some((item) => item.id === current) ? current : businesses[0]?.id ?? "");
            } catch (listError) {
                setAvailableBusinesses([]);
                setSelectedBusinessId("");
                onError({ ...errorDetails(listError), title: "БМ запущено, але список бізнесів не завантажився" });
            }
            setFeedback((current) => ({ ...current, businessLaunch: "Запуск успішний" }));
            showToast?.("БМ перевірено", "success");
        } catch (error) {
            if (businessSession) {
                try { await unwrap(window.adsBot.getBusinessManagerSession(businessSession.id)); }
                catch { setBusinessSession(null); }
            }
            onError({ ...errorDetails(error), title: "Не вдалося перевірити БМ" });
        } finally {
            setBusinessBusy(false);
        }
    };
    const refreshAvailableBusinesses = async () => {
        if (!visibleBusinessSession) return;
        setBusinessBusy(true);
        try {
            const businesses = await unwrap(window.adsBot.getAvailableBusinessManagers(visibleBusinessSession.id));
            setAvailableBusinesses(businesses);
            setSelectedBusinessId((current) => businesses.some((item) => item.id === current) ? current : businesses[0]?.id ?? "");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося оновити список БМ" });
        } finally { setBusinessBusy(false); }
    };
    const sendAccessRequest = async () => {
        if (!visibleBusinessSession || !selectedBusinessId || !adAccountId || businessBusy) return;
        setBusinessBusy(true);
        setAccessRequest(null);
        setAccessState("");
        try {
            const request = await unwrap(window.adsBot.requestBusinessAdAccountAccess(
                visibleBusinessSession.id, selectedBusinessId, adAccountId
            ));
            if (!request?.adMarketId) throw new Error("Facebook не повернув ID запиту");
            setAccessRequest(request);
            setAccessState("sent");
        } catch (error) {
            onError({ ...errorDetails(error), title: "Не вдалося надіслати запрошення" });
        } finally { setBusinessBusy(false); }
    };
    const inviteKey = (invite) => `${invite.adAccountId}:${invite.agencyId}:${invite.adMarketId}`;
    const selectedInvite = accessInvites.find((invite) => inviteKey(invite) === selectedInviteKey);
    const checkAccessInvites = async () => {
        if (!session || busy) return;
        setBusy("access.check");
        setAccessState("searching");
        setAccessError("");
        try {
            const accountIds = [...new Set(accounts.map((account) =>
                String(account.accountId || account.id || "").replace(/^act_/, ""))
                .filter((id) => /^\d+$/.test(id)))];
            if (!accountIds.length && adAccountId) accountIds.push(String(adAccountId).replace(/^act_/, ""));
            const invites = [];
            const errors = [];
            for (const accountId of accountIds) {
                try {
                    await unwrap(window.adsBot.preparePersonalAdAccountAccess(session.id, accountId));
                    const result = await unwrap(window.adsBot.listPersonalAdAccountAccess(session.id, accountId));
                    invites.push(...result.invites);
                    errors.push(...result.errors.map((error) => `РК ${accountId}, ID ${error.adMarketId}: ${error.message}`));
                } catch (error) {
                    errors.push(`РК ${accountId}: ${error.message}`);
                }
            }
            setAccessInvites(invites);
            setSelectedInviteKey((current) => invites.some((invite) => inviteKey(invite) === current)
                ? current : (invites[0] ? inviteKey(invites[0]) : ""));
            setAccessError(errors.join("; "));
            setAccessState("checked");
        } finally {
            setBusy("");
        }
    };
    const changeAccessInvite = async (operation) => {
        if (!session || !selectedInvite || busy) return;
        setBusy(`access.${operation}`);
        setAccessError("");
        try {
            await unwrap(window.adsBot.preparePersonalAdAccountAccess(session.id, selectedInvite.adAccountId));
            await unwrap(operation === "accept"
                ? window.adsBot.acceptPersonalAdAccountAccess(session.id, selectedInvite)
                : window.adsBot.rejectPersonalAdAccountAccess(session.id, selectedInvite));
            const remaining = accessInvites.filter((invite) => inviteKey(invite) !== selectedInviteKey);
            setAccessInvites(remaining);
            setSelectedInviteKey(remaining[0] ? inviteKey(remaining[0]) : "");
            setAccessState(operation === "accept" ? "accepted" : "rejected");
        } catch (error) {
            setAccessError(error.message);
            onError({ ...errorDetails(error), title: operation === "accept"
                ? "Не вдалося прийняти запрошення" : "Не вдалося відхилити запрошення" });
        } finally {
            setBusy("");
        }
    };
    const refreshOverview = async () => {
        if (!requireSession()) return;
        const value = await run("overview", () => window.adsBot.refreshPersonalAccountOverview(session.id), "Інформацію профілю оновлено");
        applyOverview(value);
    };
    const refreshSwitchableProfiles = async () => {
        if (!requireSession()) return;
        const value = await run(
            "fanpage.list",
            () => window.adsBot.getPersonalSwitchableFacebookProfiles(session.id),
            "Список фанпейджів оновлено"
        );
        if (value) setSwitchableProfiles(value);
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
        if (busy || businessBusy) return;
        setBusy("close");
        if (businessSession) {
            try {
                await unwrap(closeProfile
                    ? window.adsBot.closeBusinessManagerProfile(businessSession.id)
                    : window.adsBot.disconnectBusinessManagerSession(businessSession.id));
            } catch (error) {
                onError({ ...errorDetails(error), title: "Не вдалося завершити сесію БМ" });
                setBusy("");
                return;
            }
        }
        if (session) {
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

    const startMiniDrag = (event) => {
        dragState.current = { x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const moveMiniDrag = (event) => {
        if (!dragState.current) return;
        const deltaX = event.clientX - dragState.current.x;
        const deltaY = event.clientY - dragState.current.y;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 4) dragState.current.moved = true;
        setMiniPosition((current) => ({
            right: Math.max(8, Math.min(window.innerWidth - 80, current.right - deltaX)),
            bottom: Math.max(8, Math.min(window.innerHeight - 36, current.bottom - deltaY)),
        }));
        dragState.current.x = event.clientX;
        dragState.current.y = event.clientY;
    };
    const finishMiniDrag = () => {
        const wasDragged = dragState.current?.moved;
        dragState.current = null;
        if (!wasDragged) setMinimized(false);
    };

    if (minimized) return <div
        className="personal-account-minimized"
        style={miniPosition}
        onPointerDown={startMiniDrag}
        onPointerMove={moveMiniDrag}
        onPointerUp={finishMiniDrag}
    ><i className={session ? "online" : ""} /> Персональний акаунт №{activeProfile.profileNo}</div>;

    return <div className="overlay personal-account-layer" onMouseDown={() => void close(false)}>
        <div className="personal-account-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header className="personal-account-header">
                <div className="personal-account-title"><span className="personal-account-icon"><UserRoundCog size={22} /></span><div><span className="eyebrow">{activeProfile.profileNo ? `AdsPower №${activeProfile.profileNo}` : "AdsPower профіль не вибрано"}</span><h2>Персональний акаунт</h2></div></div>
                <div className="personal-account-session-state"><span className={session ? "online" : ""}><i /> {session ? "Puppeteer підключено" : "Профіль не запущено"}</span>{session && <small>{session.context} · actor {session.actorId || "—"}</small>}</div>
                <div className="personal-header-actions"><button type="button" className="icon-button" title="Згорнути" disabled={Boolean(busy)} onClick={() => setMinimized(true)}><Minus size={18} /></button><button type="button" className="icon-button" disabled={Boolean(busy)} onClick={() => void close(false)}><X size={18} /></button></div>
            </header>
            <div className="personal-account-layout">
                <nav className="personal-account-nav">{sections.map(([key, title, Icon], index) => <button type="button" className={`${section === key ? "active" : ""} ${key === "bm" ? "nav-business-manager" : ""}`.trim()} key={key} onClick={() => setSection(key)}><span>{completed.has(key) ? <Check size={15} /> : index + 1}</span><Icon size={16} /> {title}</button>)}</nav>
                <main className="personal-account-body">
                    {section === "launch" && <section className="personal-section personal-overview">
                        <div className="personal-section-heading"><div><span className="eyebrow">{activeProfile.profileNo ? `AdsPower №${activeProfile.profileNo}` : "AdsPower профіль не вибрано"}</span><h3>Огляд профілю</h3><p>Підключення, фанпейджі, рекламні кабінети та пікселі в одному місці.</p></div>{session && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshOverview}><RefreshCw className={busy === "overview" ? "spin" : ""} size={16} /> Оновити інфу</button>}</div>
                        <div className="personal-profile-card personal-profile-combined">
                            <div className="personal-profile-top">
                                <div className="personal-profile-details">
                                    <div className="personal-profile-name">{editingProfileName ? <input autoFocus value={profileName} maxLength="100" aria-label="Назва AdsPower-профілю" onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveProfileName(); if (event.key === "Escape") { setProfileName(activeProfile.name || ""); setEditingProfileName(false); } }} /> : <strong>{profileName || "Без назви"}</strong>}<button type="button" className="icon-button personal-edit-name" title="Змінити назву профілю" aria-label="Змінити назву профілю" disabled={Boolean(busy) || !activeProfile.profileId} onClick={() => editingProfileName ? void saveProfileName() : setEditingProfileName(true)}>{editingProfileName ? <Check size={15} /> : <Pencil size={14} />}</button></div>
                                    <div className="personal-profile-current"><input id="personal-profile-no" aria-label="Номер AdsPower-профілю" inputMode="numeric" placeholder="Номер профілю" value={profileNoDraft} onChange={(event) => setProfileNoDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void startPersonal(); }} disabled={Boolean(busy)} /><small>{activeProfile.profileNo ? `Поточний: №${activeProfile.profileNo}` : "Профіль не вибрано"}</small></div>
                                </div>
                                <div className="personal-profile-group"><span>Група</span><SearchSelect items={groups} value={profileGroupId} onChange={setProfileGroupId} getId={(item) => item.groupId} getTitle={(item) => item.groupName} getSubtitle={(item) => item.groupId} getSearchText={(item) => `${item.groupName} ${item.groupId}`} placeholder="Без групи" searchPlaceholder="Пошук групи…" ariaLabel="Група AdsPower профілю" disabled={Boolean(busy) || !activeProfile.profileId} className="personal-group-select" /><button type="button" className="icon-button" title="Оновити список груп" aria-label="Оновити список груп" disabled={Boolean(busy)} onClick={onRefreshGroups}><RefreshCw size={14} /></button><button type="button" className="text-button" disabled={Boolean(busy) || !activeProfile.profileId || !profileGroupId || String(profileGroupId) === String(activeProfile.groupId)} onClick={() => void saveProfileGroup()}>Зберегти</button></div>
                            </div>
                            <div className="personal-tags">{activeProfile.tags?.map((tag) => <span key={tag.id || tag.name}>{tag.name}</span>)}</div>
                            <div className="personal-status-grid">{[["Facebook payload", session?.overview?.hasFacebookPayload], ["Ads Manager payload", session?.overview?.hasAdsManagerPayload], ["Access token", session?.overview?.hasAccessToken]].map(([label, ready]) => <div className={`personal-status ${ready ? "ready" : ""}`} key={label}><i /> <span>{label}</span></div>)}</div>
                            <div className="personal-launch-action"><button type="button" className="primary-button personal-main-action" disabled={!/^\d+$/.test(profileNoDraft.trim()) || Boolean(busy)} aria-busy={busy === "launch" || busy === "profile.switch"} onClick={() => void startPersonal()}>{busy === "launch" || busy === "profile.switch" ? <><LoaderCircle className="spin" size={16} /> Перевіряю…</> : <><Play size={16} /> Запустити і перевірити</>}</button>{feedback.launch && <span className="personal-launch-success"><Check size={15} /> Запуск успішний</span>}</div>
                        </div>
                        <div className="personal-overview-card"><div className="personal-card-heading"><h4>Фанпейджі</h4><span>{overviewFanPages.length}</span></div>{overviewFanPages.length ? <div className="overview-page-list">{overviewFanPages.map((item) => <div key={item.pageId} className="overview-page"><div className="fanpage-avatar">{item.pictureUrl ? <img src={item.pictureUrl} alt="" /> : <PanelsTopLeft size={16} />}</div><div><strong>{item.name}</strong><small>Page ID: {item.pageId}</small><small>Profile ID: {item.additionalProfileId || "ще не визначено"}</small></div></div>)}</div> : <p className="personal-empty">{session?.overview?.fanPagesError || (session ? "Фанпейджів не знайдено." : "Список з’явиться після запуску профілю.")}</p>}</div>
                        <div className="personal-overview-card"><div className="personal-card-heading"><h4>Рекламні кабінети та пікселі</h4><span>{accounts.length}</span></div>{accounts.length ? <div className="overview-accounts">{accounts.map((account) => <div className="overview-account" key={account.id}><div><strong><i className={account.accountStatus === 1 ? "online" : ""} /> {account.name}</strong><small>{account.id}</small></div><div className="pixel-chips">{account.pixels?.slice(0, 3).map((pixel) => <span key={pixel.id}>{pixel.name} · {pixel.id}</span>)}{account.pixels?.length > 3 && <span>+ ще {account.pixels.length - 3}</span>}{!account.pixels?.length && <small>{account.pixelsError || "Пікселів немає"}</small>}</div></div>)}</div> : <p className="personal-empty">{session?.overview?.adAccountsError || (session ? "Рекламних кабінетів не знайдено." : "Рекламні кабінети ще не завантажено.")}</p>}</div>
                        <div className="personal-overview-card"><div className="personal-card-heading"><h4>Бізнес-інфо</h4><span>скоро</span></div><p className="personal-empty">Тут з’явиться бізнес-інформація вибраного рекламного кабінету.</p></div>
                    </section>}

                    {section === "bm" && <section className="personal-section personal-bm-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Business Manager</span><h3>Бізнесменеджер</h3><p>Окрема сесія БМ та доступ до РК персонального профілю.</p></div></div>
                        <div className="personal-launch-panel business"><div className="personal-launch-heading"><span>БМ-профіль</span><small>Окрема сесія</small></div><div className="personal-status-grid business">{[["Facebook payload", visibleBusinessSession?.overview?.hasFacebookPayload], ["Ads Manager payload", visibleBusinessSession?.overview?.hasAdsManagerPayload], ["Access token", visibleBusinessSession?.overview?.hasAccessToken]].map(([label, ready]) => <div className={`personal-status ${ready ? "ready" : ""}`} key={label}><i /> <span>{label}</span></div>)}</div><div className="personal-launch-action"><button type="button" className="primary-button personal-main-action" disabled={!selectedBm?.adsPowerProfileNo || businessBusy} aria-busy={businessBusy} onClick={() => void startBusiness()}>{businessBusy ? <><LoaderCircle className="spin" size={16} /> Перевіряю БМ…</> : <><Play size={16} /> Запустити і перевірити</>}</button><SearchSelect items={businessManagers} value={selectedBmKey} onChange={(value) => { setSelectedBmKey(value); setBmSelectionManual(true); setAvailableBusinesses([]); setSelectedBusinessId(""); setFeedback((current) => ({ ...current, businessLaunch: "" })); }} getId={(item) => item.accountKey} getTitle={(item) => item.name || "БМ без назви"} getSubtitle={() => "БМ-профіль"} getSearchText={(item) => `${item.name} ${item.adsPowerProfileNo ?? ""}`} placeholder="Оберіть БМ" searchPlaceholder="Пошук БМ…" ariaLabel="БМ-профіль для запуску" className="personal-bm-select" />{feedback.businessLaunch && <span className="personal-launch-success"><Check size={15} /> Запуск успішний</span>}</div></div>
                        <div className="personal-action-card"><div className="personal-card-heading"><h4>Доступні бізнесменеджери</h4><button type="button" className="secondary-button" disabled={!visibleBusinessSession || businessBusy || Boolean(busy)} onClick={() => void refreshAvailableBusinesses()}><RefreshCw size={15} /> Оновити</button></div><SearchSelect items={availableBusinesses} value={selectedBusinessId} onChange={setSelectedBusinessId} getId={(item) => item.id} getTitle={(item) => item.name} getSubtitle={(item) => `ID: ${item.id} · ${item.active ? "Активний" : "Неактивний"}`} getSearchText={(item) => `${item.name} ${item.id}`} getStatus={(item) => item.active ? "active" : "inactive"} placeholder="БМ не знайдено" searchPlaceholder="Пошук БМ…" ariaLabel="Доступний бізнесменеджер" disabled={!availableBusinesses.length || Boolean(busy)} className="personal-business-select" /></div>
                        <div className="personal-action-card personal-ad-access-card">
                            <div className="personal-card-heading"><h4>Рекламний кабінет персонального профілю</h4><button type="button" className="secondary-button" disabled={!session || Boolean(busy)} onClick={() => void refreshAccounts()}><RefreshCw size={15} /> Оновити</button></div>
                            <AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} disabled={!session || Boolean(busy)} />
                            <div className="personal-inline-actions"><button type="button" className="primary-button" disabled={!visibleBusinessSession || !selectedBusinessId || !adAccountId || businessBusy || Boolean(busy)} onClick={() => void sendAccessRequest()}>Надіслати запит на доступ</button>{accessRequest && <span className="personal-launch-success"><Check size={15} /> Запит відправлено · ID {accessRequest.adMarketId}</span>}</div>
                            <div className="personal-inline-actions personal-invite-actions">
                                <button type="button" className="secondary-button" disabled={!session || Boolean(busy)} onClick={() => void checkAccessInvites()}>{accessState === "searching" && <LoaderCircle className="spin" size={16} />} Перевірити інвайти</button>
                                <SearchSelect items={accessInvites} value={selectedInviteKey} onChange={setSelectedInviteKey} getId={inviteKey} getTitle={(item) => `ID інвайта ${item.adMarketId}`} getSubtitle={(item) => `БМ: ${availableBusinesses.find((business) => String(business.id) === item.agencyId)?.name || item.agencyId} (${item.agencyId}) · РК: ${item.adAccountId}`} getSearchText={(item) => `${item.adMarketId} ${item.agencyId} ${item.adAccountId}`} placeholder="Інвайтів не знайдено" searchPlaceholder="Пошук інвайта…" ariaLabel="Інвайт на доступ до РК" disabled={!accessInvites.length || Boolean(busy)} className="personal-invite-select" />
                                <button type="button" className="primary-button" disabled={!selectedInvite || Boolean(busy)} onClick={() => void changeAccessInvite("accept")}>Прийняти</button>
                                <button type="button" className="secondary-button" disabled={!selectedInvite || Boolean(busy)} onClick={() => void changeAccessInvite("reject")}>Відхилити</button>
                            </div>
                            {accessError && <small className="personal-invite-error">{accessError}</small>}
                            {accessState === "checked" && !accessInvites.length && !accessError && <small>Запрошень не знайдено</small>}
                            {(accessState === "accepted" || accessState === "rejected") && <span className="personal-launch-success"><Check size={15} /> Запрошення {accessState === "accepted" ? "прийнято" : "відхилено"}</span>}
                        </div>
                    </section>}

                    {section === "fanpage" && <section className="personal-section personal-fanpage">
                        <div className="personal-section-heading"><div><span className="eyebrow">Facebook</span><h3>Фанпейдж</h3><p>Перед кожною дією програма перевіряє actor і отримує свіжий payload.</p></div></div>
                        <div className="personal-action-card"><div className="personal-card-heading"><h4>Вибрати фанпейдж</h4><button type="button" className="secondary-button" disabled={!session || Boolean(busy)} onClick={refreshSwitchableProfiles}><RefreshCw size={16} /> Оновити список</button></div><label className="field"><span>Пошук за назвою або Profile ID</span><input value={fanPageSearch} placeholder="Почніть вводити…" onChange={(event) => setFanPageSearch(event.target.value)} /></label><div className="fanpage-picker">{visibleFanPages.map((item) => <button type="button" key={item.id} className={selectedFanPageId === item.id ? "selected" : ""} onClick={() => setSelectedFanPageId(item.id)}><div className="fanpage-avatar">{item.photoUrl ? <img src={item.photoUrl} alt="" /> : <PanelsTopLeft size={16} />}</div><span><strong>{item.name || "Без назви"}</strong><small>Profile ID: {item.id}</small></span></button>)}{!visibleFanPages.length && <p className="personal-empty">Оновіть список, щоб отримати доступні фанпейджі.</p>}</div><button type="button" className="secondary-button" disabled={!selectedFanPage || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const selectedName = selectedFanPage.name || "фанпейджу"; const value = await run("fanpage", () => window.adsBot.switchPersonalFanPage(session.id, { additionalProfileId: selectedFanPage.id }), `Перемкнено на: ${selectedName}`, "fanpage.switch"); if (value?.profiles) setSwitchableProfiles(value.profiles); if (value?.session) setSession(value.session); }}>Перемкнутися на вибрану фанпейджу</button></div>
                        <div className="personal-action-card"><h4>Надати Full Access</h4><p className="personal-note">Доступ буде надано фанпейджі поточного Facebook actor у відкритій вкладці. Вибирати її у списку не потрібно.</p><label className="field"><span>Facebook User ID отримувача</span><input inputMode="numeric" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value.replace(/\D/g, ""))} /></label><button type="button" className="primary-button" disabled={!targetUserId || Boolean(busy)} onClick={() => void grantFanPageAccess()}>Надати доступ</button>{feedback["fanpage.access"] && <SuccessNotice>{feedback["fanpage.access"]}</SuccessNotice>}</div>
                        <div className="personal-action-card"><h4>Створення фанпейджа</h4><label className="field"><span>Назва</span><input value={fanName} onChange={(event) => setFanName(event.target.value)} /></label><label className="checkbox-line"><input type="checkbox" checked={manualCategory} onChange={(event) => setManualCategory(event.target.checked)} /><span><strong>Ввести ID категорії вручну</strong><small>Стандартне значення: {defaultCategoryId}</small></span></label><label className="field"><span>Category ID</span><input disabled={!manualCategory} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} /></label><button type="button" className="primary-button" disabled={!fanName.trim() || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const value = await run("fanpage", () => window.adsBot.createPersonalFanPage(session.id, { name: fanName, categoryId: manualCategory ? categoryId : "" }), "Фанпейдж успішно створено", "fanpage.create"); if (value) { setSwitchableProfiles(value.profiles ?? []); setSelectedFanPageId(value.additionalProfileId); setFanName(""); } }}><PanelsTopLeft size={16} /> Створити фанпейдж</button>{feedback["fanpage.create"] && <SuccessNotice>{feedback["fanpage.create"]}</SuccessNotice>}</div>
                    </section>}

                    {section === "business" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Ads Manager</span><h3>Рекламний кабінет і business info</h3><p>Спершу ініціалізуйте Ads Manager: програма отримає свіжі payload, token і список РК.</p></div>{adsManagerReady && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw className={busy === "accounts" ? "spin" : ""} size={16} /> Оновити РК</button>}</div>
                        {!adsManagerReady && <div className="personal-action-card"><h4>Ініціалізація Ads Manager</h4><p className="personal-note">Відкрийте Ads Manager, щоб отримати токен і список РК.</p><button type="button" className="primary-button personal-main-action" disabled={Boolean(busy)} onClick={initializeAdsManager}><BriefcaseBusiness size={16} /> Ініціалізувати Ads Manager</button></div>}
                        {adsManagerReady && <AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} disabled={Boolean(busy)} />}
                        <PersonalBusinessInfoForm
                            key={`${session?.id ?? ""}:${adAccountId}`}
                            value={business}
                            ready={Boolean(adsManagerReady && adAccountId && session)}
                            checked={businessCheckedFor === adAccountId && Boolean(adAccountId)}
                            busy={Boolean(busy)}
                            refreshError={businessRefreshError}
                            onCheck={async () => {
                                if (!requireSession()) return;
                                const selectedId = adAccountId;
                                const value = await run("business", () => window.adsBot.checkPersonalBusinessInfo(session.id, { adAccountId: selectedId }), "Бізнес-інформацію перевірено", "business.check");
                                if (value && selectedId === adAccountId) {
                                    setBusiness((current) => ({ ...current, ...value }));
                                    setBusinessCheckedFor(selectedId);
                                    setBusinessRefreshError("");
                                }
                            }}
                            onSave={async (draft) => {
                                if (!requireSession()) return;
                                const selectedId = adAccountId;
                                const value = await run("business", () => window.adsBot.updatePersonalBusinessInfo(session.id, {
                                    adAccountId: selectedId,
                                    currency: draft.currency,
                                    timezone: draft.timezone,
                                    tax: { businessName: draft.businessName, businessAddress: draft },
                                }), "Бізнес-інформацію оновлено", "business.update");
                                if (value && selectedId === adAccountId) {
                                    setBusiness((current) => ({ ...current, ...value }));
                                    setBusinessRefreshError(value.refreshError ?? "");
                                    setBusinessCheckedFor(value.refreshError ? "" : selectedId);
                                }
                                return value;
                            }}
                        />

                    </section>}

                    {section === "payment" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Billing</span><h3>Додати спосіб оплати</h3><p>Карта читається із зашифрованого локального сховища; CVC не зберігається.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button></div>
                        <AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} disabled={Boolean(busy)} />
                        <PersonalPaymentSources result={paymentSources} loading={paymentSourcesLoading} error={paymentSourcesError} />
                        <label className="field"><span>Кредитна картка</span><select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Оберіть картку</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname.toUpperCase()} · {card.cardholderName} · {card.network} {card.last4} · {card.expiration}</option>)}</select></label>
                        {activeCard && <div className="selected-card-summary"><strong>{activeCard.nickname.toUpperCase()}</strong><small>{activeCard.cardholderName} · {activeCard.network} •••• {activeCard.last4} · EXP {activeCard.expiration}{activeCard.postalCode ? ` · ZIP ${activeCard.postalCode}` : ""}</small></div>}
                        <label className="field compact-field"><span>CVC · не зберігається</span><input type="password" inputMode="numeric" maxLength="4" value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, ""))} /></label>
                        <div className="personal-inline-actions">
                            <button type="button" className="primary-button personal-main-action" disabled={!session || !adAccountId || !cardId || !/^\d{3,4}$/.test(securityCode) || Boolean(busy)} onClick={addPaymentCard}><BadgeDollarSign size={16} /> Додати карту</button>
                            <button type="button" className="secondary-button" disabled={!session || !adAccountId || Boolean(busy)} onClick={checkPaymentSources}><RefreshCw className={paymentSourcesLoading ? "spin" : ""} size={16} /> Перевірити способи оплати</button>
                        </div>
                        {feedback["payment.add"] && <SuccessNotice>{feedback["payment.add"]}</SuccessNotice>}
                    </section>}

                    {section === "phone" && <section className="personal-section">
                        <div className="personal-section-heading"><div><span className="eyebrow">Verification</span><h3>Підтвердження номера телефону</h3><p>Код країни можна вводити як з плюсом, так і без нього; Facebook отримає нормалізований E.164 номер.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button></div>
                        <AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} disabled={Boolean(busy)} />
                        <PhoneVerificationNotice key={`${session?.id}:${adAccountId}`} result={phoneCheck?.sessionId === session?.id && phoneCheck?.adAccountId === adAccountId ? phoneCheck : null} />
                        <div className="phone-verification-row"><button type="button" className="secondary-button phone-verification-refresh" title="?????????? ????????? ????????" aria-label="?????????? ????????? ????????" disabled={!session || !adAccountId || Boolean(busy)} onClick={checkPhone}><RefreshCw size={16} className={busy === "phone.check" ? "spin" : ""} /></button><label className="field country"><span>Код країни</span><input inputMode="numeric" placeholder="+1" value={phoneDialingCode} onChange={(event) => { setPhoneDialingCode(event.target.value); setPhoneSent(false); setPhoneCode(""); }} /></label><label className="field"><span>Номер телефону</span><input inputMode="numeric" placeholder="2025550123" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "").slice(0, 14)); setPhoneSent(false); setPhoneCode(""); }} /></label><button type="button" className="secondary-button" disabled={!adAccountId || !hasValidPhone || Boolean(busy)} onClick={async () => { const value = await run("phone", () => window.adsBot.requestPersonalPhoneCode(session.id, { adAccountId, phoneE164, countryCode: phoneCountryCode, locale: "en_US", method: phoneMethod }), `Facebook прийняв запит і надіслав код через ${phoneVerificationMethods.find((item) => item.value === phoneMethod)?.label ?? phoneMethod}`, "phone.sent"); setPhoneSent(Boolean(value)); }}>Надіслати код</button><label className="field"><span>Код підтвердження</span><input disabled={!phoneSent} inputMode="numeric" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ""))} /></label><button type="button" className="primary-button" disabled={!phoneSent || !/^\d{4,8}$/.test(phoneCode) || Boolean(busy)} onClick={async () => { const value = await run("phone", () => window.adsBot.submitPersonalPhoneCode(session.id, { code: phoneCode }), "Код прийнято, номер телефону підтверджено", "phone.verified"); if (value) { setPhoneSent(false); setPhoneCode(""); } }}>Підтвердити</button></div>
                        <div className="phone-verification-methods" role="radiogroup" aria-label="Спосіб отримання коду">{phoneVerificationMethods.map((item) => <button key={item.value} type="button" role="radio" aria-checked={phoneMethod === item.value} className={`phone-verification-method${phoneMethod === item.value ? " selected" : ""}`} disabled={Boolean(busy)} onClick={() => { setPhoneMethod(item.value); setPhoneSent(false); setPhoneCode(""); }}>{item.label}</button>)}</div>
                        <p className="personal-note">{phoneCountryCode ? `Facebook отримає ${phoneE164} · країна ${phoneCountryCode}.` : "Для цього коду країни ще немає ISO-відповідника."}</p>{feedback["phone.sent"] && <SuccessNotice>{feedback["phone.sent"]}</SuccessNotice>}{feedback["phone.verified"] && <SuccessNotice>{feedback["phone.verified"]}</SuccessNotice>}
                        <SmsPoolPanel sessionId={session?.id ?? null} adAccountId={adAccountId} dashboard={smsPoolDashboard} onDashboard={setSmsPoolDashboard} onOrderChange={applySmsPoolOrder} onError={onError} showToast={showToast} />
                    </section>}

                    {section === "pixels" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Events Manager</span><h3>Пікселі</h3></div><div className="personal-inline-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshAccounts}><RefreshCw size={16} /> Оновити РК</button><button type="button" className="secondary-button" disabled={!adAccountId || Boolean(busy)} onClick={async () => { if (!requireSession()) return; const value = await run("pixels", () => window.adsBot.getPersonalPixels(session.id, adAccountId), "Пікселі оновлено", "pixels.list"); if (value) setPixels(value); }}><RefreshCw size={16} /> Оновити пікселі</button></div></div><AccountSelect accounts={accounts} value={adAccountId} onChange={setAdAccountId} /><div className="personal-create-row"><label className="field"><span>Назва нового пікселя</span><input value={pixelName} onChange={(event) => setPixelName(event.target.value)} /></label><button type="button" className="primary-button" disabled={!adAccountId || !pixelName.trim() || Boolean(busy)} onClick={async () => { const value = await run("pixels", () => window.adsBot.createPersonalPixel(session.id, { adAccountId, name: pixelName }), "Піксель успішно створено", "pixels.create"); if (value) { setPixelName(""); const list = await run("pixels", () => window.adsBot.getPersonalPixels(session.id, adAccountId)); if (list) setPixels(list); } }}>Створити піксель</button></div>{feedback["pixels.create"] && <SuccessNotice>{feedback["pixels.create"]}</SuccessNotice>}<div className="personal-resource-list">{pixels.map((pixel) => <div key={pixel.id}><span><strong>{pixel.name}</strong><small>{pixel.id}</small></span><button type="button" className="icon-button" title="Копіювати" onClick={() => navigator.clipboard.writeText(`${pixel.name} · ${pixel.id}`)}><Copy size={15} /></button></div>)}{!pixels.length && <div className="select-empty">Натисніть «Оновити пікселі».</div>}</div></section>}

                    {section === "api" && <section className="personal-section"><div className="personal-section-heading"><div><span className="eyebrow">Фінальний крок</span><h3>Створити API-профіль</h3><p>Cookies, User-Agent і token беруться з поточної Ads Manager сесії.</p></div></div><label className="field"><span>Назва</span><input value={apiName} onChange={(event) => setApiName(event.target.value)} /></label><label className="field"><span>Карта в назві · необов’язково</span><select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Без карти</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname.toUpperCase()} · {card.last4}</option>)}</select></label><div className="api-name-preview"><small>Назва API-клієнта</small><strong>{apiName.trim() || "Назва"}{activeCard ? ` (${activeCard.nickname} ${activeCard.last4})` : ""}</strong></div><button type="button" className="primary-button personal-main-action" disabled={!apiName.trim() || Boolean(busy)} onClick={() => requireSession() && run("api", () => window.adsBot.createPersonalApiProfile(session.id, { name: apiName, cardId }), "API-профіль створено")}><Bot size={16} /> Створити API-профіль</button></section>}
                </main>
            </div>
            <footer className="personal-account-footer"><div>{busy && <span><LoaderCircle className="spin" size={15} /> Виконується дія…</span>}{session?.reportPath && <small>Детальний звіт створюється автоматично</small>}</div><div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void close(false)}><LogOut size={16} /> Відключити Puppeteer</button><button type="button" className="danger-button" disabled={!session || Boolean(busy)} onClick={() => void close(true)}>Закрити профіль</button></div></footer>
        </div>
        {fanPagePasswordRequest && <div className="overlay" onMouseDown={(event) => { event.stopPropagation(); if (!busy) dismissFanPagePassword(); }}>
            <form className="modal" role="dialog" aria-modal="true" aria-labelledby="fanpage-password-title"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); dismissFanPagePassword(); } }}
                onSubmit={(event) => { event.preventDefault(); if (fanPagePassword && !busy) void grantFanPageAccess(fanPagePassword); }}>
                <h2 id="fanpage-password-title">Не вказано пароль Facebook</h2>
                <p>{fanPagePasswordRequest.message}</p>
                <label className="field"><span>Пароль Facebook</span><input type="password" autoFocus autoComplete="off"
                    value={fanPagePassword} disabled={Boolean(busy)} onChange={(event) => setFanPagePassword(event.target.value)} /></label>
                <div className="form-actions">
                    <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={dismissFanPagePassword}>Скасувати</button>
                    <button type="submit" className="primary-button" disabled={!fanPagePassword || Boolean(busy)}>
                        {busy ? <><LoaderCircle className="spin" size={16} /> Надання доступу…</> : "Повторити з цим паролем"}
                    </button>
                </div>
            </form>
        </div>}
    </div>;
}
