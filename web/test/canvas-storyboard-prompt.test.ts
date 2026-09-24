import { describe, expect, test } from "bun:test";

import { buildCanvasStoryboardPrompt } from "../src/lib/canvas/canvas-storyboard-prompt";

const context = {
    prompt: "父女在雨后森林找到木翅膀。\n【技能】保持动作连续。",
    projectStyle: { presetId: "rural-3d", title: "自然乡野", prompt: "温暖治愈3D，半哑光材质" },
    characters: [{ assetId: "daughter", versionId: "v2", name: "朵朵", definition: { clothes: "苔绿色开衫" } }],
    canvasAssets: [{ id: "wing-node", title: "木翅膀", type: "image" as const, tags: ["礼物"], prompt: "红绳木翅膀" }],
};

describe("canvas storyboard model prompt", () => {
    test("普通文本任务也向模型传递画风、角色版本、资产及可编辑分镜契约", () => {
        const prompt = buildCanvasStoryboardPrompt({ ...context, shotCount: 6, shotDurationSeconds: 10 });
        expect(prompt.startsWith(context.prompt)).toBe(true);
        expect(prompt).toContain(JSON.stringify(context.projectStyle));
        expect(prompt).toContain(JSON.stringify(context.characters));
        expect(prompt).toContain(JSON.stringify(context.canvasAssets));
        expect(prompt).toContain('顶层固定为 {"title": string, "rows": object[]}');
        expect(prompt).toContain("不要 Markdown");
        expect(prompt).toContain("rows 必须恰好 6 项");
        expect(prompt).toContain("durationSeconds 固定为 10");
        for (const field of ["imageGenerationPrompt", "videoMotionPrompt", "characters", "continuityOut", "negativePrompt"]) {
            expect(prompt).toContain(field);
        }
    });

    test("自动镜数和时长不被错误地限制为零", () => {
        const prompt = buildCanvasStoryboardPrompt({ ...context, characters: [], canvasAssets: [], shotCount: 0, shotDurationSeconds: 0 });
        expect(prompt).toContain("自动确定镜头数量");
        expect(prompt).toContain("根据动作和台词合理安排");
        expect(prompt).not.toContain("固定为 0");
        expect(prompt).not.toContain("恰好 0 项");
        expect(prompt).not.toContain("wing-node");
    });

    test.each([NaN, Infinity, -1, 1.5, 61])("异常时长 %s 不生成违背分镜数据契约的指令", (duration) => {
        const prompt = buildCanvasStoryboardPrompt({ ...context, shotCount: NaN, shotDurationSeconds: duration });
        expect(prompt).toContain("自动确定镜头数量");
        expect(prompt).toContain("根据动作和台词合理安排");
        expect(prompt).not.toContain("durationSeconds 固定为");
    });
});
