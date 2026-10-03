import Firstmail from "../../classes/Firstmail.js";
import extractFacebookConfirmationCode, { isFacebookCodeSubject, isFacebookSecuritySender } from "./extractFacebookConfirmationCode.js";

const activeMailboxes = new Set();
const failure = (code) => Object.assign(new Error(code), { code });

export default async function prepareFacebookCodeWaiter({ credentials, signal, onStep, mailClient, connected = false, codeTimeout = 60000, pollInterval = 2000 }) {
    if (!credentials?.login || !credentials?.password) throw failure("FIRSTMAIL_CREDENTIALS_NOT_FOUND");
    const key = credentials.login.trim().toLowerCase();
    if (activeMailboxes.has(key)) throw failure("FIRSTMAIL_MAILBOX_BUSY");
    activeMailboxes.add(key);
    const client = mailClient ?? new Firstmail(credentials);
    const emit = async (event, details = {}) => { try { await onStep?.(event, details); } catch { /* Збій журналу не зупиняє пошту. */ } };
    let cursor;
    let validity;
    let stopped = false;
    let terminalError;
    let polling = false;
    let interval;
    let deadline;
    let unsubscribe;
    let startedAt;
    let lastProgress = 0;
    let receivedCount = 0;
    let ignoredCount = 0;
    let lastIgnoreReason;
    const queue = [];
    const consumers = [];
    function cleanup(release = true) {
        stopped = true;
        clearInterval(interval);
        clearTimeout(deadline);
        unsubscribe?.();
        signal?.removeEventListener("abort", abort);
        client.close();
        if (release) activeMailboxes.delete(key);
    }
    function stop(error) {
        if (stopped) return;
        terminalError = error;
        cleanup();
        for (const consumer of consumers.splice(0)) consumer.reject(error);
        void emit("mail.wait.failed", { code: error.code, receivedCount, ignoredCount, lastIgnoreReason });
    }
    const abort = () => stop(failure("RECOVERY_ABORTED"));
    async function poll() {
        if (polling || stopped) return;
        polling = true;
        try {
            const messages = await client.listNewMessages(cursor, validity);
            if (!stopped && (messages.length || Date.now() - lastProgress >= 10000)) {
                lastProgress = Date.now();
                await emit("mail.poll", { elapsedMs: startedAt ? Date.now() - startedAt : 0,
                    remainingMs: startedAt ? Math.max(0, codeTimeout - (Date.now() - startedAt)) : codeTimeout,
                    uidFrom: cursor, foundCount: messages.length, reportedUidNext: client.lastPoll?.reportedUidNext });
            }
            for (const message of messages) {
                if (stopped) break;
                if (message.uid < cursor) continue;
                cursor = message.uid + 1;
                receivedCount += 1;
                await emit("mail.received", { uid: message.uid });
                let reason;
                if (message.size > 1024 * 1024) reason = "message_too_large";
                else if (!isFacebookSecuritySender(message.envelope?.from)) reason = "sender_mismatch";
                else if (!isFacebookCodeSubject(message.envelope?.subject)) reason = "subject_mismatch";
                if (reason) { ignoredCount += 1; lastIgnoreReason = reason; await emit("mail.ignored", { uid: message.uid, reason }); continue; }
                const match = extractFacebookConfirmationCode(await client.readMessage(message.uid), key);
                if (stopped) break;
                if (!match.code) { ignoredCount += 1; lastIgnoreReason = match.reason; await emit("mail.ignored", { uid: message.uid, reason: match.reason }); continue; }
                await emit("mail.code.found", { uid: message.uid });
                const consumer = consumers.shift();
                if (consumer) consumer.resolve(match.code); else queue.push(match.code);
                await emit("mail.code.ready", { buffered: !consumer });
                // Код уже отримано в межах таймауту; повільний DOM не повинен його втрачати.
                cleanup(false);
                break;
            }
        } catch (error) {
            stop(failure(["FIRSTMAIL_UIDVALIDITY_CHANGED", "RECOVERY_ABORTED"].includes(error.code)
                ? error.code : "FIRSTMAIL_READ_FAILED"));
        } finally { polling = false; }
    }
    try {
        await emit("mail.connect.start");
        const baseline = connected ? await client.refreshBaseline() : await client.connect(signal);
        cursor = baseline.uidNext;
        validity = baseline.uidValidity;
        if (signal?.aborted) throw failure("RECOVERY_ABORTED");
        unsubscribe = client.subscribe(() => void poll(), (error) => stop(error));
        signal?.addEventListener("abort", abort, { once: true });
        await emit("mail.listener.ready", { uidNext: cursor, timeout: codeTimeout });
        return {
            start() {
                if (terminalError) throw terminalError;
                if (stopped && queue.length) return;
                if (stopped) throw failure("FIRSTMAIL_WAITER_CLOSED");
                if (interval) return;
                startedAt = Date.now();
                deadline = setTimeout(() => stop(failure("FIRSTMAIL_CODE_TIMEOUT")), codeTimeout);
                interval = setInterval(() => void poll(), pollInterval);
                void poll();
                void emit("mail.wait.start", { timeout: codeTimeout });
            },
            waitForCode() {
                if (terminalError) return Promise.reject(terminalError);
                if (queue.length) return Promise.resolve(queue.shift());
                if (stopped) return Promise.reject(failure("FIRSTMAIL_WAITER_CLOSED"));
                return new Promise((resolve, reject) => consumers.push({ resolve, reject }));
            },
            dispose() {
                if (!stopped) stop(failure("FIRSTMAIL_WAITER_CLOSED"));
                activeMailboxes.delete(key);
                queue.length = 0;
            },
        };
    } catch (error) {
        cleanup();
        throw error;
    }
}
