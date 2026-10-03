export default async function isAccountLocked(page) {
    try {
        const url = new URL(page.url());
        return url.hostname === "www.facebook.com"
            && /^\/checkpoint\/828281030927956\/?$/.test(url.pathname);
    } catch {
        return false;
    }
}
