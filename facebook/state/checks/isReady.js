export default async function isReady(page) {
    return page.url().includes("facebook.com");
}
