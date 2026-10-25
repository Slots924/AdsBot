import "dotenv/config";
import AdsPower from "../../classes/AdsPower.js";
import grantProfileFanPageAccess from "../../workflows/autoupload/grantProfileFanPageAccess.js";

const args = process.argv.slice(2);
const supported = new Set(["--profile-no", "--profile-id", "--page-id", "--target-user-id"]);
const values = new Map();
for (let index = 0; index < args.length; index += 2) {
    if (!supported.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--") || values.has(args[index])) {
        throw new Error("Очікуються --profile-no або --profile-id, --page-id та --target-user-id");
    }
    values.set(args[index], args[index + 1]);
}

// Пароль читається з AdsPower; аргументи та журнал не містять секретних даних.
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
const result = await grantProfileFanPageAccess({
    adsPower: new AdsPower(), profileNo: values.get("--profile-no"), profileId: values.get("--profile-id"),
    additionalProfileId: values.get("--page-id"), targetUserId: values.get("--target-user-id"),
    signal: controller.signal, onStage: stage => console.log(JSON.stringify({ stage })),
});
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
