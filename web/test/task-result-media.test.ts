import { describe, expect, it } from "bun:test";
import { resultMediaUrls } from "../src/pages/tasks/task-result-media";

describe("task result media", () => {
    it("previews the saved video resource once when both url aliases are present", () => {
        const url = "/api/resources/saved-video/file";
        expect(resultMediaUrls(JSON.stringify({
            mode: "video",
            video: { url, dataUrl: url, storageKey: "resource:saved-video", width: 496, height: 864, durationMs: 6060 },
            videoSpecification: { status: "mismatch", warnings: ["实际尺寸与选择不同"] },
        }))).toEqual([url]);
    });

    it("preserves image resources and legacy provider media previews", () => {
        expect(resultMediaUrls(JSON.stringify({ images: [
            { url: "/api/resources/saved-image/file?version=1" },
            { url: "https://media.example/result" },
            { dataUrl: "data:image/png;base64,AA==" },
        ] }))).toEqual(["/api/resources/saved-image/file?version=1", "https://media.example/result", "data:image/png;base64,AA=="]);
    });

    it("does not interpret unrelated relative API routes or malformed results as media", () => {
        expect(resultMediaUrls(JSON.stringify({ url: "/api/tasks/task-id", storageKey: "resource:id" }))).toEqual([]);
        expect(resultMediaUrls("not-json")).toEqual([]);
        expect(resultMediaUrls()).toEqual([]);
    });
});
