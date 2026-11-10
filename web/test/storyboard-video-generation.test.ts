import { expect, test } from "bun:test";

test.each(["create", "direct", "first-frame", "cancel"])("storyboard video %s keeps the shot and submission boundary", async (scenario) => {
    const worker = new Worker(new URL("./helpers/storyboard-video-generation.worker.ts", import.meta.url), { type: "module" });
    try {
        const result = await new Promise<any>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage(scenario);
        });
        expect(result.error).toBeUndefined();
        if (scenario === "cancel") {
            expect(result.metadata.prompt).toBe("运镜短句");
            expect(result.metadata.taskId).toBe("failed-task");
            expect(result.queued).toEqual([]);
            return;
        }
        for (const field of result.expectedFields) {
            expect(result.metadata.prompt).toContain(field);
            expect(result.metadata.composerContent).toContain(field);
            expect(result.spec.prompt).toContain(field);
        }
        expect(result.spec.options.durationSeconds).toBe(5);
        expect(result.metadata.taskId).toBeUndefined();
        expect(result.metadata.taskStatus).toBeUndefined();
        expect(result.metadata.videoEditOperation).toBe(scenario === "first-frame" ? "image_to_video" : "text_to_video");
        if (scenario === "first-frame") expect(result.metadata.videoStartFrameNodeId).toBe(result.imageId);
        if (scenario === "create") {
            expect(result.queued).toEqual([]);
            expect(result.confirmations).toEqual([]);
        } else {
            expect(result.confirmations).toHaveLength(1);
            expect(result.queued).toEqual([{ mode: "storyboard_video", targets: [{ rowId: "row", nodeId: result.videoId }] }]);
        }
    } finally {
        worker.terminate();
    }
});

test.each([
    ["merged", 10],
    ["merged-18", 18],
] as const)("%s submits one video with the combined duration and dialogues", async (scenario, duration) => {
    const worker = new Worker(new URL("./helpers/storyboard-video-generation.worker.ts", import.meta.url), { type: "module" });
    try {
        const result = await new Promise<any>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage(scenario);
        });
        expect(result.error).toBeUndefined();
        expect(result.spec.options.durationSeconds).toBe(duration);
        expect(result.spec.prompt).toContain("女儿：爸？");
        expect(result.spec.prompt).toContain("女儿：我来帮你。");
        if (scenario === "merged-18") {
            expect(result.spec.prompt).toContain("12–18 秒（原镜头 14）");
            expect(result.spec.prompt).toContain("父亲：谢谢。");
        }
        expect(result.generationContext.prompt).toContain("本段参考素材：@图片1");
        expect(result.generationContext.referenceImages).toHaveLength(1);
        expect(result.confirmations).toHaveLength(1);
        expect(result.queued).toEqual([{ mode: "storyboard_video", targets: [{ rowId: result.mergedRowId, nodeId: result.mergedVideoId }] }]);
    } finally {
        worker.terminate();
    }
});

test("does not submit when the model cannot generate the merged duration", async () => {
    const worker = new Worker(new URL("./helpers/storyboard-video-generation.worker.ts", import.meta.url), { type: "module" });
    try {
        const result = await new Promise<any>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage("merged-unsupported");
        });
        expect(result.error).toBeUndefined();
        expect(result.queued).toEqual([]);
        expect(result.confirmations).toEqual([]);
        expect(result.warnings.join(" ")).toContain("不支持合并镜头的时长");
    } finally {
        worker.terminate();
    }
});
