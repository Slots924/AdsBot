import assert from "node:assert/strict";

import { dismissButtonLabels }
    from "../facebook/actions/dismissAutomatedBehavior.js";
import isAutomatedBehavior, {
    automatedBehaviorTexts,
} from "../facebook/state/checks/isAutomatedBehavior.js";


const indonesianWarning = "Kami mencurigai perilaku otomatis di akun Anda";

assert(automatedBehaviorTexts.includes(indonesianWarning));
assert(dismissButtonLabels.includes("Tutup"));

const originalDocument = globalThis.document;
globalThis.document = {
    querySelectorAll(selector) {
        assert.equal(selector, "span");
        return [{ textContent: "  KAMI MENCURIGAI PERILAKU OTOMATIS DI AKUN ANDA  " }];
    },
};

try {
    const detected = await isAutomatedBehavior({
        url: () => "https://www.facebook.com/checkpoint/123",
        evaluate: (callback, texts) => callback(texts),
    });
    assert.equal(detected, true);
} finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
}

console.log("Перевірка індонезійського попередження automation пройшла успішно");
