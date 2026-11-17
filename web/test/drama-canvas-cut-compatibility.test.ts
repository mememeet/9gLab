import { describe, expect, test } from "bun:test";
import { dramaCanvasPath, encodeDramaCanvasFocus, parseDramaCanvasFocus } from "../src/services/drama-canvas";

describe("legacy episode editing links", () => {
    test("continue to open the episode cut on its original canvas", () => {
        const focus = { kind: "cut" as const, episodeId: "episode-1" };
        expect(parseDramaCanvasFocus(encodeDramaCanvasFocus(focus))).toEqual(focus);
        const url = new URL(dramaCanvasPath("canvas-1", "drama-1", focus), "http://localhost");
        expect(url.pathname).toBe("/canvas/canvas-1");
        expect(url.searchParams.get("drama")).toBe("drama-1");
        expect(parseDramaCanvasFocus(url.searchParams.get("dramaFocus"))).toEqual(focus);
    });
});
