import { describe, expect, it, mock } from "bun:test";
import type { AgentRun } from "@/services/api/agent";

const data = new Map<string, string>();
mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: (scope: string) => ({
        getItem: async (key: string) => data.get(`${scope}:${key}`) ?? null,
        setItem: async (key: string, value: string) => { data.set(`${scope}:${key}`, value); },
        removeItem: async (key: string) => { data.delete(`${scope}:${key}`); },
    }),
}));
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "user" }));
mock.module("@/lib/markdown-plain-text", () => ({ markdownPlainText: (text: string) => text.trim() }));

const { loadCloudAgentConversations, saveCloudAgentConversations } = await import("@/services/cloud-agent-conversations");

describe("canvas Agent storage", () => {
    it("keeps separate active conversations and drafts for each canvas and account", async () => {
        const conversation = (id: string, draft: string) => ({ id, draft, title: "新对话", messages: [], run: null, permissionMode: "read_only" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
        await saveCloudAgentConversations("a", [conversation("a", "画布 A 草稿")], "user", "canvas-a");
        await saveCloudAgentConversations("b", [conversation("b", "画布 B 草稿")], "user", "canvas-b");
        expect((await loadCloudAgentConversations("user", "canvas-a")).conversations[0].draft).toBe("画布 A 草稿");
        expect((await loadCloudAgentConversations("user", "canvas-b")).activeId).toBe("b");
        expect((await loadCloudAgentConversations("other-user", "canvas-a")).conversations).toEqual([]);
    });

    it("recovers clearly assigned legacy drafts without changing the legacy snapshot", async () => {
        const legacy = { id: "draft", localNewCanvasId: "canvas-c", draft: "保留旧草稿", title: "新对话", messages: [], run: null, permissionMode: "read_only" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
        await saveCloudAgentConversations("draft", [legacy], "user");
        expect((await loadCloudAgentConversations("user", "canvas-c")).conversations[0].draft).toBe("保留旧草稿");
        expect((await loadCloudAgentConversations("user", "canvas-d")).conversations).toEqual([]);
        expect((await loadCloudAgentConversations("user")).activeId).toBe("draft");
    });

    it("does not assign a legacy conversation spanning multiple canvases", async () => {
        const first = { id: "one", canvasId: "canvas-e" } as AgentRun;
        const second = { id: "two", canvasId: "canvas-f", parentId: "one" } as AgentRun;
        const legacy = { id: "mixed", title: "旧对话", messages: [], run: second, runs: [first, second], permissionMode: "read_only" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
        await saveCloudAgentConversations("mixed", [legacy], "mixed-user");
        expect((await loadCloudAgentConversations("mixed-user", "canvas-e")).conversations).toEqual([]);
        expect((await loadCloudAgentConversations("mixed-user", "canvas-f")).conversations).toEqual([]);
        expect((await loadCloudAgentConversations("mixed-user")).conversations[0].id).toBe("mixed");
    });

    it("recovers a complete legacy conversation when all turns belong to one canvas", async () => {
        const first = { id: "first", canvasId: "canvas-g" } as AgentRun;
        const second = { id: "second", canvasId: "canvas-g", parentId: "first" } as AgentRun;
        const legacy = { id: "single", title: "旧对话", messages: [], run: second, runs: [first, second], permissionMode: "read_only" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
        await saveCloudAgentConversations("single", [legacy], "single-user");
        expect((await loadCloudAgentConversations("single-user", "canvas-g")).activeId).toBe("single");
        expect((await loadCloudAgentConversations("single-user", "canvas-h")).conversations).toEqual([]);
    });
});
