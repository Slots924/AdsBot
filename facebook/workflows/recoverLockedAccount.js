import detectAccountRecoveryStep from "../state/detectAccountRecoveryStep.js";
import requestRecoveryValue from "../browser/requestRecoveryValue.js";
import { clickRecoveryControl, typeRecoveryValue, waitRecoveryCondition, emitRecoveryStep, throwIfRecoveryAborted } from "../browser/recoveryControls.js";
import handleAccountProtection from "../modals/accountProtection.js";
import { getFacebookCredentials, getFirstmailCredentials, saveRecoveredFacebookPassword, appendRecoveryPasswordNote } from "../../services/adspower/profileCredentials.js";
import readRecoveryPassword from "../../services/adspower/recoveryPassword.js";
import Firstmail from "../../classes/Firstmail.js";
import prepareFacebookCodeWaiter from "../../services/mail/prepareFacebookCodeWaiter.js";

const runningPages = new WeakSet();

export default async function recoverLockedAccount(page, options = {}) {
    const result = { recovered: false, passwordChanged: false, credentialsSaved: false, step: "UNKNOWN", code: null, availableMethods: [] };
    if (runningPages.has(page)) return { ...result, code: "RECOVERY_ALREADY_RUNNING" };
    runningPages.add(page);
    const started = Date.now();
    let newPassword = options.newPassword;
    let codeAttempts = 0;
    let passwordSubmitted = false;
    const settings = { timeout: 60000, ...options };
    const requestCode = options.requestConfirmationCode;
    let mailClient;
    let codeWaiter;
    const nextStep = async (previous, rejection = null, hadRejection = false, submitControl = "next") => {
        let rejectionCleared = !hadRejection;
        let pendingObserved = false;
        let diagnosticAt = 0;
        return waitRecoveryCondition(page, async () => {
            const snapshot = await detectAccountRecoveryStep(page);
            if (snapshot.step === "UNKNOWN" && Date.now() - diagnosticAt >= 5000) {
                diagnosticAt = Date.now();
                await emitRecoveryStep(settings, "state.unrecognized", {
                    step: snapshot.step, readyState: snapshot.readyState, loading: snapshot.loading,
                    methodDiagnostics: snapshot.methodDiagnostics, controls: snapshot.controls,
                });
            }
            if (rejection && !snapshot[rejection]) rejectionCleared = true;
            if (snapshot.controls[submitControl].enabled === 0) pendingObserved = true;
            const freshRejection = rejection && snapshot[rejection]
                && (rejectionCleared || (pendingObserved && snapshot.controls[submitControl].enabled > 0));
            return (snapshot.step !== "UNKNOWN" && snapshot.step !== previous) || freshRejection ? snapshot : false;
        }, settings, `перехід після ${previous}`);
    };
    try {
        throwIfRecoveryAborted(settings.signal);
        newPassword ??= await readRecoveryPassword();
        if (!options.adsPower || !options.profile?.profile_id) {
            throw Object.assign(new Error("Відсутній контекст AdsPower-профілю"), { code: "PROFILE_CONTEXT_REQUIRED" });
        }
        const profile = await options.adsPower.getProfileById(options.profile.profile_id);
        let firstmail;
        try { firstmail = getFirstmailCredentials(profile); } catch { firstmail = null; }
        const facebook = getFacebookCredentials(profile);
        await emitRecoveryStep(settings, "recovery.start", {
            timeout: settings.timeout, facebookCredentialsAvailable: Boolean(facebook), firstmailCredentialsAvailable: Boolean(firstmail),
        });
        const ensureRecoveryMail = async () => {
            if (!firstmail) throw Object.assign(new Error("Облікові дані Firstmail не знайдені або неповні"), { code: "FIRSTMAIL_CREDENTIALS_NOT_FOUND" });
            if (requestCode || mailClient) return;
            mailClient = options.firstmailClient ?? new Firstmail(firstmail);
            await emitRecoveryStep(settings, "mail.auth.start");
            await mailClient.connect(settings.signal);
            await emitRecoveryStep(settings, "mail.auth.complete");
        };
        for (let transitions = 0; transitions < 24; transitions += 1) {
            throwIfRecoveryAborted(settings.signal);
            if (Date.now() - started > (settings.totalTimeout ?? 180000)) {
                throw Object.assign(new Error("Перевищено загальний час recovery"), { code: "RECOVERY_TOTAL_TIMEOUT" });
            }
            const snapshot = await detectAccountRecoveryStep(page);
            result.step = snapshot.step;
            if (snapshot.availableMethods?.length) result.availableMethods = snapshot.availableMethods;
            await emitRecoveryStep(settings, "state.detected", { transition: transitions, elapsedMs: Date.now() - started, step: snapshot.step });
            if (passwordSubmitted && ["AUTHENTICATED", "PROTECTION_DIALOG"].includes(snapshot.step)) {
                result.passwordChanged = true;
                await emitRecoveryStep(settings, "password.change.confirmed");
                for (let attempt = 1; attempt <= 3; attempt += 1) {
                    await emitRecoveryStep(settings, "credentials.save.start", { attempt });
                    try {
                        await saveRecoveredFacebookPassword(options.adsPower, profile.profile_id, newPassword);
                        result.credentialsSaved = true;
                        await emitRecoveryStep(settings, "credentials.save.verified", { attempt });
                        break;
                    } catch {
                        await emitRecoveryStep(settings, "credentials.save.failed", { attempt });
                    }
                }
                if (!result.credentialsSaved) {
                    result.recovered = snapshot.step === "AUTHENTICATED";
                    throw Object.assign(new Error("Пароль змінено, але не підтверджено його збереження в AdsPower"), { code: "CREDENTIALS_SAVE_FAILED" });
                }
                passwordSubmitted = false;
            }
            switch (snapshot.step) {
                case "GET_STARTED":
                    await clickRecoveryControl(page, "start", settings);
                    await nextStep(snapshot.step);
                    break;
                case "CHOOSE_RECOVERY_METHOD": {
                    let stableSince = Date.now();
                    let previousMethods = snapshot.availableMethods.join(",");
                    const selection = await waitRecoveryCondition(page, async () => {
                        const current = await detectAccountRecoveryStep(page);
                        if (current.step !== "CHOOSE_RECOVERY_METHOD" && current.step !== "UNKNOWN") return current;
                        if (current.emailAvailable) return current;
                        const methods = current.availableMethods?.join(",") ?? "";
                        // Відсутність email підтверджуємо лише на стабільному завантаженому екрані.
                        if (current.step !== "CHOOSE_RECOVERY_METHOD" || current.readyState !== "complete" || current.loading
                            || !methods || current.availableMethods.includes("email") || methods !== previousMethods) {
                            stableSince = Date.now();
                            previousMethods = methods;
                            return false;
                        }
                        return Date.now() - stableSince >= 1000 ? current : false;
                    }, settings, "доступні методи відновлення");
                    if (selection.step !== "CHOOSE_RECOVERY_METHOD") break;
                    result.availableMethods = selection.availableMethods;
                    await emitRecoveryStep(settings, "recovery.methods", { availableMethods: result.availableMethods });
                    if (!selection.emailAvailable) {
                        throw Object.assign(new Error("Відновлення підтримується лише через email"), { code: "NO_SUPPORTED_RECOVERY_METHOD" });
                    }
                    await ensureRecoveryMail();
                    await clickRecoveryControl(page, "email", settings);
                    await nextStep(snapshot.step);
                    break;
                }
                case "CHOOSE_EMAIL":
                    await ensureRecoveryMail();
                    await clickRecoveryControl(page, "email", settings);
                    await nextStep(snapshot.step);
                    break;
                case "EMAIL_CONTACT":
                    await ensureRecoveryMail();
                    if (snapshot.emailContactCount !== 1) {
                        throw Object.assign(new Error("Неоднозначний вибір email"), { code: "AMBIGUOUS_EMAIL_CONTACT" });
                    }
                    if (!snapshot.emailSelected) await clickRecoveryControl(page, "radio", settings);
                    await waitRecoveryCondition(page, async () => (await detectAccountRecoveryStep(page)).emailSelected,
                        settings, "вибір email");
                    if (!requestCode) {
                        codeWaiter?.dispose();
                        codeWaiter = await prepareFacebookCodeWaiter({ credentials: firstmail, mailClient, connected: true,
                            signal: settings.signal, onStep: (event, details) => emitRecoveryStep(settings, event, details),
                            codeTimeout: settings.codeTimeout ?? 60000 });
                        codeWaiter.start();
                    }
                    await clickRecoveryControl(page, "next", settings);
                    await nextStep(snapshot.step);
                    break;
                case "CONFIRMATION_CODE": {
                    codeAttempts += 1;
                    if (codeAttempts > (settings.maxCodeAttempts ?? 3)) {
                        throw Object.assign(new Error("Вичерпано спроби підтвердження коду"), { code: "CODE_ATTEMPTS_EXHAUSTED" });
                    }
                    await emitRecoveryStep(settings, "code.request", { attempt: codeAttempts, rejected: snapshot.codeRejected });
                    // Провайдер отримує дані пошти лише в пам'яті, без журналювання контексту.
                    if (!requestCode && !codeWaiter) {
                        throw Object.assign(new Error("Немає межі нових листів перед відправленням"), { code: "FIRSTMAIL_SEND_REQUIRED" });
                    }
                    const code = requestCode ? await requestCode({ page, kind: "code", retry: codeAttempts > 1,
                        signal: settings.signal, onStep: settings.onStep, manualTimeout: settings.manualTimeout,
                        firstmailCredentials: firstmail, attempt: codeAttempts }) : await codeWaiter.waitForCode();
                    await emitRecoveryStep(settings, "code.received", { provider: requestCode ? "custom" : "Firstmail" });
                    await emitRecoveryStep(settings, "code.input.start");
                    await typeRecoveryValue(page, "code", code, settings);
                    await emitRecoveryStep(settings, "code.input.complete");
                    const beforeSubmit = await detectAccountRecoveryStep(page);
                    await clickRecoveryControl(page, "next", settings);
                    await emitRecoveryStep(settings, "code.submit.complete");
                    const after = await nextStep(snapshot.step, "codeRejected", beforeSubmit.codeRejected);
                    if (after.codeRejected && after.step === snapshot.step) {
                        await emitRecoveryStep(settings, "code.rejected", { attempt: codeAttempts });
                        if (!requestCode) throw Object.assign(new Error("Facebook відхилив отриманий код"), { code: "FACEBOOK_CODE_REJECTED" });
                    }
                    break;
                }
                case "CURRENT_PASSWORD":
                    if (!facebook) throw Object.assign(new Error("Немає поточного пароля Facebook"), { code: "FACEBOOK_CREDENTIALS_MISSING" });
                    await typeRecoveryValue(page, "password", facebook.password, settings);
                    await clickRecoveryControl(page, "next", settings);
                    if ((await nextStep(snapshot.step, "passwordRejected")).passwordRejected) {
                        throw Object.assign(new Error("Facebook відхилив поточний пароль"), { code: "CURRENT_PASSWORD_REJECTED" });
                    }
                    break;
                case "NEW_PASSWORD":
                    if (!newPassword) newPassword = await requestRecoveryValue({ page, kind: "newPassword",
                        signal: settings.signal, onStep: settings.onStep, manualTimeout: settings.manualTimeout });
                    appendRecoveryPasswordNote(profile.remark, newPassword);
                    await typeRecoveryValue(page, "password", newPassword, settings);
                    passwordSubmitted = true;
                    await clickRecoveryControl(page, "save", settings);
                    if ((await nextStep(snapshot.step, "passwordRejected", snapshot.passwordRejected, "save")).passwordRejected) {
                        passwordSubmitted = false;
                        throw Object.assign(new Error("Facebook відхилив новий пароль"), { code: "NEW_PASSWORD_REJECTED" });
                    }
                    break;
                case "PROTECTION_DIALOG":
                case "AUTHENTICATED":
                    await handleAccountProtection(page, settings);
                    await waitRecoveryCondition(page, async () => (await detectAccountRecoveryStep(page)).step === "AUTHENTICATED",
                        settings, "авторизований інтерфейс Facebook");
                    result.recovered = true;
                    result.step = "AUTHENTICATED";
                    await emitRecoveryStep(settings, "recovery.complete", { ...result, elapsedMs: Date.now() - started });
                    return result;
                case "UNKNOWN":
                    await nextStep("UNKNOWN");
                    break;
                default:
                    throw Object.assign(new Error("Recovery перейшов на непідтримуваний екран"), { code: "UNSUPPORTED_RECOVERY_SCREEN" });
            }
        }
        throw Object.assign(new Error("Перевищено кількість переходів recovery"), { code: "RECOVERY_TRANSITION_LIMIT" });
    } catch (error) {
        result.code = error.name === "AbortError" ? (error.code ?? "RECOVERY_ABORTED") : (error.code ?? "RECOVERY_FAILED");
        result.passwordChangeUnconfirmed = passwordSubmitted && !result.passwordChanged;
        // Довільні повідомлення провайдерів можуть містити секрети.
        await emitRecoveryStep(settings, "recovery.failed", { ...result, errorType: error.name, elapsedMs: Date.now() - started });
        return result;
    } finally {
        codeWaiter?.dispose();
        mailClient?.close();
        newPassword = null;
        runningPages.delete(page);
    }
}
