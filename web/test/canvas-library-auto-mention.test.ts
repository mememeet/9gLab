import { describe, expect, test } from "bun:test";
import { autoMentionLibraryAssets, collectLibraryAssetsForMatching } from "../src/lib/canvas/canvas-library-auto-mention";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { prepareCanvasAssetLinks } from "../src/lib/canvas/canvas-auto-link-assets";
import { applyCanvasConnectionPromptSync } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { defaultConfig } from "../src/stores/use-config-store";
import type { Asset } from "../src/stores/use-asset-store";

const base = { librarySavedAt: "2026-01-01", coverUrl: "", tags: [], createdAt: "", updatedAt: "" };
const character: Asset = { ...base, librarySavedAt: undefined, id: "hero", title: "站上", kind: "entity", category: "character", data: { definition: {} } };
const image: Asset = { ...base, id: "scene", title: "宫门", kind: "image", data: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, mimeType: "image/png" } };

describe("one-click library mentions", () => {
    test("reads every page before matching and does not return partial results on error", async () => {
        const pages: number[] = [];
        const assets = await collectLibraryAssetsForMatching([], async (page) => {
            pages.push(page);
            return page === 1 ? { assets: [character], hasMore: true } : { assets: [image], hasMore: false };
        });
        expect(pages).toEqual([1, 2]);
        expect(autoMentionLibraryAssets("站上去宫门", assets, []).assetIds).toEqual(["hero", "scene"]);
        await expect(
            collectLibraryAssetsForMatching([], async (page) => {
                if (page === 2) throw new Error("network");
                return { assets: [character], hasMore: true };
            }),
        ).rejects.toThrow("network");
    });

    test("preserves script and existing mentions, links every occurrence and is idempotent", () => {
        const script = "站上走向宫门。\n站上回头看宫门。 @[asset:hero] @图片1";
        const result = autoMentionLibraryAssets(script, [character, image], []);
        expect(result.prompt).toBe("@[asset:hero]走向@[asset:scene]。\n@[asset:hero]回头看@[asset:scene]。 @[asset:hero] @图片1");
        expect(result.assetIds).toEqual(["hero", "scene"]);
        expect(result.occurrences).toBe(4);
        expect(autoMentionLibraryAssets(result.prompt, [character, image], []).prompt).toBe(result.prompt);
    });

    test("skips duplicate names, archived and unsupported assets, and uses longest name", () => {
        const duplicate = { ...character, id: "hero-2" };
        const longName = { ...image, id: "long", title: "宫门广场" };
        const archived = { ...image, id: "archived", title: "旧场景", status: "archived" as const };
        const result = autoMentionLibraryAssets("站上到宫门广场，再到宫门和旧场景", [character, duplicate, image, longName, archived], []);
        expect(result.prompt).toBe("站上到@[asset:long]，再到@[asset:scene]和旧场景");
        expect(result.conflicts).toEqual(["站上"]);
        expect(result.conflictAssetIds).toEqual(["hero", "hero-2"]);
    });

    test("links connected references and avoids guessing when a library asset has the same name", () => {
        const connected = { id: "node-1", nodeId: "node-1", kind: "image" as const, label: "图片1", title: "宫门", active: true };
        const linked = autoMentionLibraryAssets("宫门在远处", [], [connected]);
        expect(linked.prompt).toBe("@图片1在远处");
        expect(linked.matchedCount).toBe(1);
        const ambiguous = autoMentionLibraryAssets("宫门在远处", [image], [connected]);
        expect(ambiguous.prompt).toBe("宫门在远处");
        expect(ambiguous.conflicts).toEqual(["宫门"]);
    });

    test("escapes names and does not match part of an English identifier", () => {
        const special = { ...image, id: "special", title: "场景(夜)+" };
        const english = { ...image, id: "alice", title: "Alice" };
        expect(autoMentionLibraryAssets("场景(夜)+出现，Alice和Alice2", [special, english], []).prompt).toBe("@[asset:special]出现，@[asset:alice]和Alice2");
        expect(autoMentionLibraryAssets("@图片1站上出场", [character], []).prompt).toBe("@图片1@[asset:hero]出场");
    });

    test("matching names are true generation inputs for both text and video nodes", () => {
        const prompt = autoMentionLibraryAssets("站上走向宫门，站上停下", [character, image], []).prompt;
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Video]) {
            const node: CanvasNodeData = { id: "target", type, title: "target", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { composerContent: prompt } };
            const context = buildNodeGenerationContext(node.id, [node], [], prompt, [character, image]);
            expect(context.characterReferences.map((item) => item.assetId)).toEqual(["hero"]);
            expect(context.referenceImages.map((item) => item.id)).toEqual(["scene"]);
            expect(context.prompt).not.toContain("@[asset:");
        }
    });

    test("creates and reuses real graph links, with node references that disappear on disconnection", async () => {
        const original = "站上走向宫门，站上回头。没有的名字继续保留。";
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { composerContent: original } };
        const match = autoMentionLibraryAssets(original, [character, image], []);
        const createNode = async (assetId: string) =>
            assetId === "hero"
                ? { id: "hero-node", type: CanvasNodeType.Text, title: "站上", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { workflowKind: "character" as const, characterAssetId: "hero", assetId: "hero" } }
                : { id: "scene-node", type: CanvasNodeType.Image, title: "宫门", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: image.data.dataUrl, assetId: "scene" } };
        let id = 0;
        const plan = await prepareCanvasAssetLinks({ nodes: [target], connections: [], targetId: target.id, prompt: match.prompt, assetIds: match.assetIds, config: defaultConfig, createNode, createId: () => `edge-${++id}` });
        expect(plan.connections.map((edge) => [edge.fromNodeId, edge.toNodeId])).toEqual([
            ["hero-node", "target"],
            ["scene-node", "target"],
        ]);
        expect(plan.prompt).toContain("没有的名字继续保留");
        expect(plan.prompt).not.toContain("@[asset:");
        const context = buildNodeGenerationContext(target.id, plan.nodes, plan.connections, plan.prompt, [character, image], true);
        expect(context.characterReferences.map((reference) => reference.assetId)).toEqual(["hero"]);
        expect(context.referenceImages.map((reference) => reference.id)).toEqual(["scene-node"]);
        const repeated = await prepareCanvasAssetLinks({ nodes: plan.nodes, connections: plan.connections, targetId: target.id, prompt: plan.prompt, assetIds: match.assetIds, config: defaultConfig, createNode, createId: () => `edge-${++id}` });
        expect(repeated.created).toHaveLength(0);
        expect(repeated.connections).toHaveLength(2);
        const remaining = plan.connections.filter((edge) => edge.fromNodeId !== "hero-node");
        const afterRemoval = applyCanvasConnectionPromptSync(plan.nodes, plan.connections, plan.nodes, remaining);
        const afterPrompt = afterRemoval.find((node) => node.id === target.id)!.metadata!.composerContent!;
        expect(afterPrompt).not.toContain("@角色");
    });

    test("places newly inserted assets without covering existing nodes", async () => {
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Text, title: "目标", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} };
        const blocker: CanvasNodeData = { id: "blocker", type: CanvasNodeType.Text, title: "已有节点", position: { x: -220, y: 0 }, width: 100, height: 100, metadata: { content: "原有内容" } };
        const plan = await prepareCanvasAssetLinks({
            nodes: [target, blocker],
            connections: [],
            targetId: "target",
            prompt: "@[asset:hero]",
            assetIds: ["hero"],
            config: defaultConfig,
            createId: () => "edge",
            createNode: async () => ({ id: "hero-node", type: CanvasNodeType.Text, title: "站上", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { workflowKind: "character", characterAssetId: "hero", assetId: "hero" } }),
        });
        const added = plan.created[0];
        expect(added.position.y >= blocker.position.y + blocker.height + 32 || added.position.y + added.height + 32 <= blocker.position.y).toBe(true);
        expect(plan.nodes.find((node) => node.id === "blocker")).toEqual(blocker);
    });

    test("leaves the graph unchanged when a matched asset cannot be connected", async () => {
        const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Text, title: "目标", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { composerContent: "声音" } };
        const audioNode: CanvasNodeData = { id: "audio", type: CanvasNodeType.Audio, title: "声音", position: { x: -200, y: 0 }, width: 100, height: 100, metadata: { content: "audio", assetId: "audio-id" } };
        const nodes = [target];
        const connections: [] = [];
        await expect(prepareCanvasAssetLinks({ nodes, connections, targetId: "target", prompt: "@[asset:audio-id]", assetIds: ["audio-id"], config: defaultConfig, createId: () => "edge", createNode: async () => audioNode })).rejects.toThrow(
            "不能连接参考音频",
        );
        expect(nodes).toEqual([target]);
        expect(connections).toEqual([]);
        expect(target.metadata?.composerContent).toBe("声音");
    });
});
