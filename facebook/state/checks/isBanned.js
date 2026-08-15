export default async function isBanned(page) {
    return page.url().includes("www.facebook.com/checkpoint");
}
