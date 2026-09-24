import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { hydrateNodeGenerationContext, type NodeGenerationContext } from "../src/components/canvas/canvas-node-generation";

const context: NodeGenerationContext = {
    prompt: "让首帧中的人物向前走", referenceImages: [], referenceVideos: [], referenceAudios: [],
    characterReferences: [], resolvedCharacterVersions: [], resolvedCharacterVoices: [],
    textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0,
};
let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetchSpy?.mockRestore());

describe("canvas image reference hydration", () => {
    test("cloud keyframes keep their authorized resource identity without downloading OSS bytes", async () => {
        fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("CORS blocked"));
        const image = { id: "shot-1", name: "首帧.png", type: "image/png", dataUrl: "https://oss.example/expired.png", storageKey: "resource:shot-resource", width: 2048, height: 2048 };
        const result = await hydrateNodeGenerationContext({ ...context, referenceImages: [image] }, "canvas", undefined, "video");
        expect(result.referenceImages).toEqual([{ ...image, dataUrl: "" }]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("inline local image content remains available to the upload path", async () => {
        const image = { id: "local", name: "local.png", type: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" };
        const result = await hydrateNodeGenerationContext({ ...context, referenceImages: [image] }, "canvas", undefined, "image");
        expect(result.referenceImages).toEqual([image]);
    });
});
