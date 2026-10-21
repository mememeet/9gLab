import { mock } from "bun:test";

self.onmessage = async (event) => {
    const scenario = event.data as string;
    const events: string[] = [];
    let persisted = false;
    mock.module("../../src/stores/canvas/use-canvas-store", () => ({
        flushCanvasStorePersistence: async () => {
            events.push("canvas");
            if (scenario === "local-failure") throw new Error("local storage unavailable");
        },
    }));
    mock.module("../../src/stores/use-asset-store", () => ({
        flushAssetStorePersistence: async () => {
            await Promise.resolve();
            events.push("assets");
            persisted = true;
        },
    }));
    mock.module("../../src/services/generation-consumer-lifecycle", () => ({
        withGenerationConsumersPaused: async (operation: () => Promise<unknown>) => {
            events.push("pause");
            try {
                return await operation();
            } finally {
                events.push("resume");
            }
        },
    }));
    const { ApiError } = await import("../../src/services/api/request");
    mock.module("../../src/services/user-data-sync", () => ({
        hasRemoteUserDataSyncSession: () => true,
        saveRemoteUserDataNow: async () => {
            events.push("remote");
            if (scenario === "cloud-failure") throw new Error("media not uploaded");
            if (scenario === "identity-failure" || scenario === "restore") throw new ApiError("identity changed", { status: 409 });
        },
        withRemoteUserDataSyncExclusive: async (operation: () => Promise<unknown>) => {
            events.push("lock");
            return operation();
        },
        resetRemoteUserDataSync: () => events.push("reset"),
    }));
    Object.defineProperty(globalThis, "window", {
        value: {
            localStorage: { setItem: () => events.push("notify") },
            location: { assign: () => events.push("navigate") },
        },
    });
    const { changeSupportIdentity, SupportLoginCloudSaveError } = await import("../../src/services/support-login-session");
    try {
        await changeSupportIdentity(
            async () => {
                if (!persisted) throw new Error("operation preceded persistence");
                events.push("operation");
                if (scenario === "operation-failure") throw new Error("support denied");
            },
            "/",
            scenario === "restore",
            { saveLocallyOnly: ["local-only", "local-failure", "operation-failure"].includes(scenario) },
        );
        self.postMessage({ events });
    } catch (error) {
        self.postMessage({ events, canContinueLocally: error instanceof SupportLoginCloudSaveError, message: error instanceof Error ? error.message : String(error) });
    }
};
