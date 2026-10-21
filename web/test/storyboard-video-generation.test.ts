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
