import { wait } from "../browser/timing.js";


export default async function fillLoginCredentials(page, options = {}) {
    await wait(10000, options);
}
