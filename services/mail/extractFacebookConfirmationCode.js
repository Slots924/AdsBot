export function isFacebookCodeSubject(subject) {
    return /^(\d{6})\s+is your (?:facebook security code|code to confirm this email address)[.!]?$/i
        .test(String(subject ?? "").replace(/\s+/g, " ").trim());
}

export function isFacebookSecuritySender(addresses) {
    return addresses?.length === 1 && String(addresses[0].address ?? "").toLowerCase() === "security@facebookmail.com";
}

export default function extractFacebookConfirmationCode(mail, recipient) {
    if (!isFacebookSecuritySender(mail.from?.value)) return { reason: "sender_mismatch" };
    const recipients = [...(mail.to?.value ?? []), ...(mail.cc?.value ?? [])];
    if (!recipients.some((item) => String(item.address).toLowerCase() === recipient.toLowerCase())) return { reason: "recipient_mismatch" };
    const subject = String(mail.subject ?? "").replace(/\s+/g, " ").trim();
    if (!isFacebookCodeSubject(subject)) return { reason: "subject_mismatch" };
    const code = subject.slice(0, 6);
    // HTML спочатку перетворює MIME-парсер; коди зі сторонніх URL не враховуємо.
    const body = String(mail.text ?? "").replace(/https?:\/\/\S+/gi, " ");
    if (!/confirm this email address|verify your email address/i.test(body)) return { reason: "body_context_mismatch" };
    const codes = new Set([...body.matchAll(/(?:^|[^\d])(\d{6})(?!\d)/g)].map((match) => match[1]));
    for (const line of body.split(/\r?\n/)) {
        if (/^\s*(?:\d[ \t\u00a0]*){6}\s*$/.test(line)) codes.add(line.replace(/\s/g, ""));
    }
    if (codes.size !== 1 || !codes.has(code)) return { reason: "code_ambiguous" };
    return { code };
}
