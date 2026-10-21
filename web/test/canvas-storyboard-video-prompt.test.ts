import { describe, expect, test } from "bun:test";
import { attachNodeToStoryboardRow, createCanvasNode, createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { readNodeGenerationSpec } from "@/lib/canvas/generation-contract";
import { storyboardVideoPrompt } from "@/lib/canvas/canvas-storyboard-video-prompt";
import { CanvasNodeType } from "@/types/canvas";

describe("storyboard video prompt", () => {
    test("keeps the full shot in the editable draft and the canonical generation request", () => {
        const row = createStoryboardRow(12, {
            id: "shot-12",
            durationSeconds: 5,
            plotDescription: "父亲提着水桶走出阳台，裤腿沾泥，双手冻红；女儿眼眶发红。",
            dialogue: "女儿：爸，你在做什么？",
            viewerPOV: "女儿视角看到父亲。",
            performanceBlocking: "父亲低头提桶，女儿转身看见父亲。",
            shotSize: "父亲全景，女儿近景。",
            narrativeIntent: "女儿发现父亲受委屈。",
            emotion: "羞愧与心疼。",
            lightingAndAtmosphere: "阳台门逆光，客厅烟雾。",
            camera: "固定机位，再反打女儿。",
            motion: "先跟随父亲走出，再切女儿反应。",
            videoMotionPrompt: "固定全景跟随父亲走出阳台，再切女儿近景。",
            timeBeats: "0-2秒父亲出阳台；2-4秒女儿看到；4-5秒台词。",
            audioEffects: "水声与桶提手声。",
            continuityOut: "女儿望向父亲，双眼湿润。",
            mustHave: ["水桶", "冻红的双手"],
            optionalDetails: ["裤腿泥水"],
            negativePrompt: "不要字幕或额外人物。",
        });
        const script = createCanvasNode(CanvasNodeType.Script, { x: 0, y: 0 }, { storyboard: { rows: [row], visibleColumns: ["videoMotionPrompt"], referenceNodeIds: [] } });
        const video = createCanvasNode(
            CanvasNodeType.Video,
            { x: 800, y: 0 },
            {
                prompt: row.videoMotionPrompt,
                seconds: "10",
            },
        );
        video.metadata = { ...video.metadata, generationSpec: readNodeGenerationSpec(video) };
        const result = attachNodeToStoryboardRow([script, video], { fromNodeId: script.id, toNodeId: video.id, fromHandleId: `row:${row.id}` });
        const linked = result.find((node) => node.id === video.id)!;
        for (const field of [
            row.plotDescription,
            row.dialogue,
            row.viewerPOV,
            row.performanceBlocking,
            row.shotSize,
            row.narrativeIntent,
            row.emotion,
            row.lightingAndAtmosphere,
            row.camera,
            row.motion,
            row.videoMotionPrompt,
            row.timeBeats,
            row.audioEffects,
            row.continuityOut,
            ...row.mustHave,
            ...row.optionalDetails,
            row.negativePrompt,
        ]) {
            expect(linked.metadata?.prompt).toContain(field);
            expect(linked.metadata?.composerContent).toContain(field);
            expect(readNodeGenerationSpec(linked)?.prompt).toContain(field);
        }
        expect(readNodeGenerationSpec(linked)?.options.durationSeconds).toBe(5);
        expect(video.metadata?.generationSpec?.prompt).toBe(row.videoMotionPrompt);
    });

    test("omits empty fields and supports old rows without optional details", () => {
        expect(storyboardVideoPrompt(createStoryboardRow(1))).toBe("");
        const row = createStoryboardRow(1, { plotDescription: "  角色推开门。  ", videoMotionPrompt: " \n ", mustHave: undefined, optionalDetails: undefined });
        expect(storyboardVideoPrompt(row)).toBe("【画面描述】\n角色推开门。");
        expect(storyboardVideoPrompt(createStoryboardRow(2, { videoMotionPrompt: "镜头缓慢推近。" }))).toContain("镜头缓慢推近。");
    });

    test("updates an existing result's editable draft without changing its original prompt", () => {
        const row = createStoryboardRow(1, { plotDescription: "新画面", dialogue: "新的台词" });
        const script = createCanvasNode(CanvasNodeType.Script, { x: 0, y: 0 }, { storyboard: { rows: [row], visibleColumns: [], referenceNodeIds: [] } });
        const video = createCanvasNode(CanvasNodeType.Video, { x: 800, y: 0 }, { prompt: "原始生成提示词", content: "/api/resources/existing-video" });
        const linked = attachNodeToStoryboardRow([script, video], { fromNodeId: script.id, toNodeId: video.id, fromHandleId: `row:${row.id}` }).find((node) => node.id === video.id)!;
        expect(linked.metadata?.prompt).toBe("原始生成提示词");
        expect(linked.metadata?.content).toBe(video.metadata?.content);
        expect(linked.metadata?.composerContent).toContain(row.dialogue);
        expect(readNodeGenerationSpec(linked)?.prompt).toContain(row.plotDescription);
    });
});
