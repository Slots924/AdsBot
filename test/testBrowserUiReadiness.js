import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import waitForUiReady, { uiReadyInPage } from "../facebook/browser/waitForUiReady.js";
import { inspectTraceDom } from "../facebook/browser/inspectTraceDom.js";
import { nameChangeOutcomeInPage } from "../facebook/actions/changeFacebookName.js";
import { aboutDomRuntime } from "../facebook/actions/fillFacebookPersonalProfileAbout.js";

const previous = Object.fromEntries(["document", "getComputedStyle", "innerWidth", "innerHeight"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalNow = Date.now;
let clock = 0;
const node = ({ text = "Save", label = "Save", disabled = false, tag = "BUTTON", role = "button" } = {}) => ({
    tagName: tag, textContent: text, innerText: text, disabled, isConnected: true, childElementCount: 0,
    getAttribute(name) { return name === "role" ? role : name === "aria-label" ? label : null; },
    getBoundingClientRect() { return { x: 10, y: 10, left: 10, top: 10, right: 80, bottom: 40, width: 70, height: 30 }; },
    closest() { return null; }, querySelectorAll() { return []; }, matches() { return false; },
    contains(other) { return other === this; },
});

try {
    Date.now = () => clock;
    globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
    globalThis.innerWidth = 1000;
    globalThis.innerHeight = 800;
    let target = node();
    const document = { readyState: "interactive", querySelectorAll: () => [target] };
    globalThis.document = document;
    const settings = { token: "a", stableMs: 180, requireEnabled: true };
    assert.equal(uiReadyInPage("button", settings), false);
    clock = 200;
    assert.equal(uiReadyInPage("button", settings), true);
    target.disabled = true;
    assert.equal(uiReadyInPage("button", settings), false);
    target.disabled = false;
    assert.equal(uiReadyInPage("button", settings), false);
    clock = 400;
    target = node();
    assert.equal(uiReadyInPage("button", settings), false);
    clock = 600;
    assert.equal(uiReadyInPage("button", settings), true);
    document.readyState = "loading";
    assert.equal(uiReadyInPage("button", settings), false);
    document.readyState = "interactive";
    document.querySelectorAll = () => [node({ text: "Other" }), target];
    assert.equal(uiReadyInPage("button", { ...settings, token: "text", expectedText: "sAvE" }), false);
    clock = 800;
    assert.equal(uiReadyInPage("button", { ...settings, token: "text", expectedText: "sAvE" }), true);
    assert.equal(uiReadyInPage("button", { ...settings, token: "missing", expectedText: "Missing" }), false);

    // Функція сканера має працювати без зовнішнього JS-контексту після серіалізації.
    const sandboxDocument = { readyState: "interactive", querySelectorAll: (selector) => selector === "#save" ? [target] : [] };
    class SandboxElement {
        static [Symbol.hasInstance](value) { return typeof value?.getBoundingClientRect === "function"; }
    }
    const sandbox = { document: sandboxDocument, Element: SandboxElement,
        window: { getComputedStyle: globalThis.getComputedStyle }, Date,
        query: { mode: "find", kind: "selector", selector: "#save", stableToken: "serialized" } };
    const serialized = `(${aboutDomRuntime.toString()})(query)`;
    assert.equal(runInNewContext(serialized, sandbox), false);
    clock = 1000;
    assert.equal(runInNewContext(serialized, sandbox), target);
    target.disabled = true;
    assert.equal(runInNewContext(serialized, sandbox), false);
    target.disabled = false;

    const workHeading = node({ tag: "H2", role: "heading", text: "Work" });
    let workSaved = false;
    const section = { ...node({ tag: "SECTION" }), querySelectorAll: (selector) => selector === "h2"
        ? [workHeading] : selector === ".edit" && workSaved ? [target] : [] };
    sandboxDocument.querySelectorAll = (selector) => selector === "section" ? [section] : [];
    sandbox.query = { mode: "inspect", kind: "workSaveOutcome", selectors: { save: ".save", editWorkplace: ".edit" } };
    assert.equal(runInNewContext(serialized, sandbox), false);
    workSaved = true;
    assert.equal(runInNewContext(serialized, sandbox).saved, true);

    const privateNode = node({ tag: "INPUT", role: "textbox", text: "private password", label: "private@example.test" });
    privateNode.value = "private password";
    const safeNode = node({ text: "sAvE", label: "SAVE" });
    const coveredNode = node({ text: "Save" });
    const root = { ...node({ tag: "MAIN", role: "main" }),
        querySelectorAll: () => [privateNode, safeNode], matches: () => false };
    document.body = root;
    document.querySelectorAll = (selector) => selector === "button.target" ? [safeNode, privateNode]
        : selector.startsWith("main,") ? [root] : [];
    document.elementFromPoint = () => coveredNode;
    const snapshot = inspectTraceDom({ uiTexts: ["Save"], selector: "button.target", maxNodes: 2 });
    assert.doesNotMatch(JSON.stringify(snapshot), /private|password|example.test/);
    assert.equal(snapshot.elements[1].text, "sAvE");
    assert.equal(snapshot.target.total, 2);
    assert.equal(snapshot.target.candidates[0].covered, true);
    assert.equal(snapshot.elements[0].text, "[поле]");

    const heading = node({ tag: "H2", role: "heading", text: "New prompt for Fixture Person" });
    const dialog = { ...node({ tag: "DIV", role: "dialog", label: "New prompt" }),
        querySelector: () => heading, querySelectorAll: () => [heading, privateNode] };
    heading.closest = (selector) => selector.includes("dialog") ? dialog : null;
    privateNode.closest = heading.closest;
    document.querySelectorAll = (selector) => selector === "input,textarea" ? [privateNode]
        : selector.startsWith('[role="dialog"]') ? [dialog] : [];
    const unknown = inspectTraceDom({ sensitiveTexts: ["Fixture", "Person"] });
    assert.match(unknown.dialogs[0].title, /New prompt/);
    assert.doesNotMatch(JSON.stringify(unknown), /Fixture|Person|private@example|private password/);

    document.querySelectorAll = (selector) => selector === ".name" ? [node({ text: "Test Person" })] : [];
    assert.equal(nameChangeOutcomeInPage({ finalName: ".name", expectedName: "Test Person", dialogs: ".dialogs", patterns: [] }), true);
    assert.equal(nameChangeOutcomeInPage({ finalName: ".name", expectedName: "Other Person", dialogs: ".dialogs", patterns: [] }), false);
    document.querySelectorAll = (selector) => selector === ".dialogs" ? [node({ text: "Changed in the LAST 60 DAYS" })] : [];
    assert.equal(nameChangeOutcomeInPage({ finalName: ".name", expectedName: "Other Person", dialogs: ".dialogs", patterns: ["last\\s+60\\s+days"] }), true);
} finally {
    Date.now = originalNow;
    for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
}

let disposed = false;
let options;
await waitForUiReady({ async waitForFunction(_callback, _wait, _selector, settings) {
    options = settings;
    return { async dispose() { disposed = true; } };
} }, ".button", { timeout: 90 });
assert.equal(disposed, true);
assert.equal(options.stableMs, 30);
await assert.rejects(() => waitForUiReady({}, ".button", { timeout: 0 }), RangeError);
console.log("Browser UI readiness tests passed");
