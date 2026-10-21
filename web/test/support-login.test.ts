import { describe, expect, test } from "bun:test";
import { apiClient, http } from "../src/services/api/request";
import { startSupportLogin, stopSupportLogin } from "../src/services/api/support-login";
import { useUserStore, type LocalUser } from "../src/stores/use-user-store";
import { requestIdentityHeaders } from "../src/lib/request-identity";

const admin: LocalUser = { id: "admin-user", username: "admin", displayName: "Admin", role: "admin", status: "active" };
const target: LocalUser = { id: "target-user", username: "target", displayName: "Target", role: "user", status: "active" };

describe("support login identity boundaries", () => {
    test("API requests carry the mounted identity rather than another tab's storage identity", async () => {
        const previousUser = useUserStore.getState().user;
        try {
            for (const user of [admin, target, null]) {
                useUserStore.getState().setUser(user);
                await http.patch(
                    "/canvas-projects/canvas/operations",
                    { operations: [] },
                    {
                        adapter: async (config) => {
                            expect(config.headers.get("X-Canvas-User-ID")).toBe(user?.id);
                            return { data: { code: 0, data: {}, msg: "ok" }, status: 200, statusText: "OK", headers: {}, config };
                        },
                    },
                );
            }
        } finally {
            useUserStore.getState().setUser(previousUser);
        }
    });

    test("a mounted account's cache scope stays pinned until that tab explicitly switches", async () => {
        const worker = new Worker(new URL("./helpers/support-scope.worker.ts", import.meta.url), { type: "module" });
        try {
            const result = await new Promise<unknown>((resolve, reject) => {
                worker.onmessage = (event) => resolve(event.data);
                worker.onerror = (event) => reject(new Error(event.message));
            });
            expect(result).toEqual({ anonymous: "guest", pinned: "admin-user", before: "canvas:user:admin-user", after: "canvas:user:target-user" });
        } finally {
            worker.terminate();
        }
    });

    test("support start and stop use authenticated POSTs without exposing session credentials", async () => {
        const originalAdapter = apiClient.defaults.adapter;
        const previousUser = useUserStore.getState().user;
        const requests: Array<{ url?: string; method?: string; data: unknown }> = [];
        useUserStore.getState().setUser(admin);
        apiClient.defaults.adapter = async (config) => {
            expect(config.withCredentials).toBe(true);
            expect(config.headers.get("X-Canvas-User-ID")).toBe(admin.id);
            requests.push({ url: config.url, method: config.method, data: JSON.parse(config.data) });
            return { data: { code: 0, data: { user: target }, msg: "ok" }, status: 200, statusText: "OK", headers: {}, config };
        };
        try {
            await startSupportLogin("target/user", "排查分镜提示词");
            await stopSupportLogin();
            expect(requests).toEqual([
                { url: "/admin/users/target%2Fuser/support-login", method: "post", data: { reason: "排查分镜提示词" } },
                { url: "/auth/support-login/stop", method: "post", data: {} },
            ]);
            expect(requestIdentityHeaders()).toEqual({ "X-Canvas-User-ID": admin.id });
        } finally {
            apiClient.defaults.adapter = originalAdapter;
            useUserStore.getState().setUser(previousUser);
        }
    });
});
