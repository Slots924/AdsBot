export default async function isBanned(page) {
    const currentUrl = page.url();

    return [
        "www.facebook.com/checkpoint",
        "www.facebook.com/confirmemail",
    ].some((blockedUrl) => currentUrl.includes(blockedUrl));
}
