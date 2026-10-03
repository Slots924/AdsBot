import detectAccountRecoveryStep from "../state/detectAccountRecoveryStep.js";
import { clickRecoveryControl, waitRecoveryCondition, emitRecoveryStep } from "../browser/recoveryControls.js";

export default async function handleAccountProtection(page, options = {}) {
    try {
        await waitRecoveryCondition(page, async () => (await detectAccountRecoveryStep(page)).protectionDialog,
            options, "фінальний protection dialog", options.protectionTimeout ?? 10000);
    } catch (error) {
        if (error.code !== "RECOVERY_TIMEOUT") throw error;
        await emitRecoveryStep(options, "protection.absent");
        return false;
    }
    await clickRecoveryControl(page, "back", options);
    await waitRecoveryCondition(page, async () => !(await detectAccountRecoveryStep(page)).protectionDialog,
        options, "закриття protection dialog");
    return true;
}
