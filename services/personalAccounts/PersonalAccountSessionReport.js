import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { sanitize } from "../logging/AppLogger.js";


export default class PersonalAccountSessionReport {
    #operation = Promise.resolve();


    constructor({ reportsDirectory, sessionId, profileNo }) {
        this.reportsDirectory = path.resolve(reportsDirectory);
        this.sessionId = String(sessionId);
        this.profileNo = String(profileNo);
        this.file = path.join(this.reportsDirectory, `${this.sessionId}.jsonl`);
    }


    append(action, details = {}) {
        const event = sanitize({
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            profileNo: this.profileNo,
            action,
            ...details,
        });
        const operation = async () => {
            await mkdir(this.reportsDirectory, { recursive: true });
            await appendFile(this.file, `${JSON.stringify(event)}\n`, "utf8");
        };
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }
}
