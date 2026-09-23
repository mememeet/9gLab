import { describe, expect, test } from "bun:test";

import { buildCanvasAgentLaunchPrompt, type CanvasAgentLaunchIntent } from "../src/services/canvas-agent-launch";

describe("canvas Agent homepage launch", () => {
    test("preserves the chosen media model, specifications, references, and skills", () => {
        const intent: CanvasAgentLaunchIntent = {
            version: 1,
            id: "launch-12345678",
            canvasId: "canvas-1",
            prompt: "生成一张未来感产品海报",
            mode: "image",
            targetModel: { value: "system-image::gpt-image", displayName: "GPT Image", logicalModelId: "image-poster" },
            settings: { ratio: "4:5", quality: "high", count: "2" },
            skillIds: ["skill-brand"],
            assetIds: ["asset-a", "asset-b"],
            createdAt: "2026-09-18T00:00:00.000Z",
        };

        const prompt = buildCanvasAgentLaunchPrompt(intent);

        expect(prompt).toContain("生成一张未来感产品海报");
        expect(prompt).toContain("模型「GPT Image」");
        expect(prompt).toContain("logicalModelId=image-poster");
        expect(prompt).toContain("4:5 · high · 2 张");
        expect(prompt).toContain("已放入当前画布，共 2 个");
        expect(prompt).toContain("@[skill:skill-brand]");
    });
});
