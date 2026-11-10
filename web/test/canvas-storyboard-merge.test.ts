import { describe, expect, test } from "bun:test";

import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { mergeStoryboardRows, restoreStoryboardRows } from "@/lib/canvas/canvas-storyboard-merge";
import { storyboardVideoPrompt } from "@/lib/canvas/canvas-storyboard-video-prompt";
import { isolateCopiedNodeMetadata } from "@/lib/canvas/canvas-node-copy";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasConnection } from "@/types/canvas";

describe("merge storyboard shots", () => {
    const rows = [
        createStoryboardRow(1, { id: "a", durationSeconds: 6, plotDescription: "开门", dialogue: "你好", videoMotionPrompt: "推镜", assetBindings: [{ nodeId: "asset", role: "character", priority: 100 }] }),
        createStoryboardRow(2, { id: "b", durationSeconds: 6, plotDescription: "回头", dialogue: "再见", audioEffects: "风声" }),
        createStoryboardRow(3, { id: "c", durationSeconds: 6, plotDescription: "走远" }),
    ];
    const connections: CanvasConnection[] = [
        { id: "input", fromNodeId: "asset", toNodeId: "script", toHandleId: "row:a" },
        { id: "output", fromNodeId: "script", toNodeId: "video", fromHandleId: "row:b", storyboardRowId: "b", relation: "storyboard-output" },
        { id: "other", fromNodeId: "script", toNodeId: "third", fromHandleId: "row:c" },
    ];

    test("replaces consecutive rows with an ordered timeline and restores the original rows and links", () => {
        const result = mergeStoryboardRows(rows, connections, "script", ["b", "a"]);
        const merged = result.rows[0];
        expect(result.rows).toHaveLength(2);
        expect(merged.durationSeconds).toBe(12);
        const prompt = storyboardVideoPrompt(merged);
        expect(prompt).toContain("0–6 秒（原镜头 1）");
        expect(prompt).toContain("6–12 秒（原镜头 2）");
        for (const text of ["开门", "回头", "推镜", "你好", "再见", "风声"]) expect(prompt).toContain(text);
        expect(merged.assetBindings[0].nodeId).toBe("asset");
        expect(result.connections.some((item) => item.toHandleId === `row:${merged.id}` && item.fromNodeId === "asset")).toBe(true);
        const saved = JSON.parse(JSON.stringify(result));
        const restored = restoreStoryboardRows(saved.rows, saved.connections, "script", merged.id, new Set(["script", "asset", "video", "third"]));
        expect(restored.rows).toEqual(rows);
        expect(restored.connections.map((item) => item.id).sort()).toEqual(["input", "other", "output"]);
    });

    test("rejects nonadjacent selections and durations above 30 seconds", () => {
        expect(() => mergeStoryboardRows(rows, connections, "script", ["a", "c"])).toThrow("相邻");
        expect(() =>
            mergeStoryboardRows(
                [
                    { ...rows[0], durationSeconds: 20 },
                    { ...rows[1], durationSeconds: 11 },
                ],
                [],
                "script",
                ["a", "b"],
            ),
        ).toThrow("30 秒");
        expect(
            mergeStoryboardRows(
                [
                    { ...rows[0], durationSeconds: 15 },
                    { ...rows[1], durationSeconds: 15 },
                ],
                [],
                "script",
                ["a", "b"],
            ).rows[0].durationSeconds,
        ).toBe(30);
    });

    test("restores rows and reports connections whose nodes were deleted", () => {
        const result = mergeStoryboardRows(rows, connections, "script", ["a", "b"]);
        const restored = restoreStoryboardRows(result.rows, result.connections, "script", result.mergedId, new Set(["script", "asset", "third"]));
        expect(restored.rows).toEqual(rows);
        expect(restored.missingReferences).toBe(true);
        expect(restored.connections.map((connection) => connection.id)).not.toContain("output");
    });

    test("does not remove another storyboard's connections with the same row IDs", () => {
        const other: CanvasConnection = { id: "other-script-output", fromNodeId: "another-script", toNodeId: "another-video", fromHandleId: "row:a", storyboardRowId: "a", relation: "storyboard-output" };
        const result = mergeStoryboardRows(rows, [...connections, other], "script", ["a", "b"]);
        expect(result.connections).toContainEqual(other);
    });

    test("copies the merged prompt without retaining restore links to the original board", () => {
        const merged = mergeStoryboardRows(rows, connections, "script", ["a", "b"]).rows[0];
        const script = createCanvasNode(CanvasNodeType.Script, { x: 0, y: 0 }, { storyboard: { rows: [merged], visibleColumns: [], referenceNodeIds: [] } });
        const copied = isolateCopiedNodeMetadata(script, new Map([["asset", "asset-copy"]]));
        expect(copied.storyboard?.rows[0].mergeOrigin).toBeUndefined();
        expect(copied.storyboard?.rows[0].videoMotionPrompt).toContain("@[node:asset-copy]");
    });
});
