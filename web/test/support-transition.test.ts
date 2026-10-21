import { expect, test } from "bun:test";

test.each([
    ["normal", { events: ["pause", "remote", "lock", "canvas", "assets", "operation", "reset", "notify", "navigate", "resume"] }],
    ["cloud-failure", { events: ["pause", "remote", "resume"], canContinueLocally: true, message: "media not uploaded" }],
    ["identity-failure", { events: ["pause", "remote", "resume"], canContinueLocally: false, message: "identity changed" }],
    ["local-only", { events: ["pause", "lock", "canvas", "assets", "operation", "reset", "notify", "navigate", "resume"] }],
    ["local-failure", { events: ["pause", "lock", "canvas", "assets", "resume"], canContinueLocally: false, message: "local storage unavailable" }],
    ["operation-failure", { events: ["pause", "lock", "canvas", "assets", "operation", "resume"], canContinueLocally: false, message: "support denied" }],
    ["restore", { events: ["pause", "remote", "lock", "canvas", "assets", "operation", "reset", "notify", "navigate", "resume"] }],
])("support transition: %s", async (scenario, expected) => {
    const worker = new Worker(new URL("./helpers/support-transition.worker.ts", import.meta.url), { type: "module" });
    try {
        const result = await new Promise<unknown>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage(scenario);
        });
        expect(result).toEqual(expected);
    } finally {
        worker.terminate();
    }
});
