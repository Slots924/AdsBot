function mailError(code) {
    return Object.assign(new Error(code), { code });
}

export default class Firstmail {
    constructor(credentials, { clientFactory, parseMessage, host = process.env.FIRSTMAIL_IMAP_HOST || "imap.firstmail.ltd", port = 993 } = {}) {
        if (!credentials?.login || !credentials?.password) throw mailError("FIRSTMAIL_CREDENTIALS_NOT_FOUND");
        this.credentials = credentials;
        this.clientFactory = clientFactory;
        this.parseMessage = parseMessage;
        this.host = host;
        this.port = port;
    }

    async connect(signal) {
        if (signal?.aborted) throw mailError("RECOVERY_ABORTED");
        try {
            let factory = this.clientFactory;
            if (!factory) {
                const { ImapFlow } = await import("imapflow");
                factory = (options) => new ImapFlow(options);
            }
            this.client = factory({ host: this.host, port: this.port, secure: true,
                auth: { user: this.credentials.login, pass: this.credentials.password },
                logger: false, logRaw: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
            this.client.on("error", () => {});
            const abort = () => this.close();
            signal?.addEventListener("abort", abort, { once: true });
            try {
                await this.client.connect();
                await this.client.mailboxOpen("INBOX", { readOnly: true });
                if (signal?.aborted) throw mailError("RECOVERY_ABORTED");
            } finally { signal?.removeEventListener("abort", abort); }
            return await this.refreshBaseline();
        } catch (error) {
            this.close();
            if (signal?.aborted) throw mailError("RECOVERY_ABORTED");
            if (error.code === "ERR_MODULE_NOT_FOUND") throw mailError("FIRSTMAIL_DEPENDENCIES_MISSING");
            throw mailError(error.authenticationFailed || /auth|login|credential/i.test(String(error.responseStatus) + String(error.serverResponseCode))
                ? "FIRSTMAIL_AUTH_FAILED" : "FIRSTMAIL_CONNECTION_FAILED");
        }
    }

    baseline() {
        const mailbox = this.client?.mailbox;
        if (!mailbox?.uidValidity || !mailbox.uidNext) throw mailError("FIRSTMAIL_MAILBOX_INVALID");
        return { uidValidity: String(mailbox.uidValidity), uidNext: Number(mailbox.uidNext) };
    }

    async refreshBaseline() {
        try {
            const mailbox = await this.client.status("INBOX", { uidValidity: true, uidNext: true });
            if (!mailbox?.uidValidity || !mailbox.uidNext) throw mailError("FIRSTMAIL_MAILBOX_INVALID");
            const existing = await this.client.search({ all: true }, { uid: true }) || [];
            const highestUid = existing.reduce((maximum, uid) => Math.max(maximum, uid), 0);
            return { uidValidity: String(mailbox.uidValidity), uidNext: Math.max(Number(mailbox.uidNext), highestUid + 1) };
        } catch (error) {
            throw mailError(error.code === "FIRSTMAIL_MAILBOX_INVALID" ? error.code : "FIRSTMAIL_CONNECTION_LOST");
        }
    }

    subscribe(onNewMail, onFailure) {
        const failed = () => onFailure(mailError("FIRSTMAIL_CONNECTION_LOST"));
        this.client.on("exists", onNewMail);
        this.client.on("close", failed);
        this.client.on("error", failed);
        return () => {
            this.client.off("exists", onNewMail);
            this.client.off("close", failed);
            this.client.off("error", failed);
        };
    }

    async listNewMessages(uidNext, uidValidity) {
        const status = await this.client.status("INBOX", { uidValidity: true, uidNext: true });
        if (String(status.uidValidity) !== uidValidity) throw mailError("FIRSTMAIL_UIDVALIDITY_CHANGED");
        // UIDNEXT може запізнюватися; наявність нових листів перевіряємо пошуком UID.
        const uids = (await this.client.search({ uid: `${uidNext}:*` }, { uid: true }) || [])
            .filter((uid) => uid >= uidNext).sort((a, b) => a - b).slice(0, 100);
        this.lastPoll = { uidFrom: uidNext, reportedUidNext: Number(status.uidNext), foundCount: uids.length };
        if (!uids.length) return [];
        return (await this.client.fetchAll(uids.join(","), { envelope: true, size: true, internalDate: true }, { uid: true }))
            .sort((a, b) => a.uid - b.uid);
    }

    async readMessage(uid) {
        const message = await this.client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message?.source || message.source.length > 1024 * 1024) throw mailError("FIRSTMAIL_MESSAGE_TOO_LARGE");
        let parse = this.parseMessage;
        if (!parse) ({ simpleParser: parse } = await import("mailparser"));
        return parse(message.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 1024 * 1024 });
    }

    close() { this.client?.close(); }
}
