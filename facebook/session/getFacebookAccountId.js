// Читає власника сесії лише з cookies, які застосовуються до Facebook.
export default function getFacebookAccountId(cookies) {
    const cookie = (cookies ?? []).find(item => {
        const domain = String(item.domain ?? "").replace(/^\./, "").toLowerCase();
        return (item.key ?? item.name) === "c_user"
            && (domain === "facebook.com" || domain.endsWith(".facebook.com"));
    });
    const id = String(cookie?.value ?? "");
    return /^[1-9]\d*$/.test(id) ? id : null;
}
