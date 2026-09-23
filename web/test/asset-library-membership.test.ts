import { describe, expect, test } from "bun:test";

import { isAssetSavedToLibrary, saveAssetToLibrary } from "@/lib/asset-library-membership";
import type { NewAsset } from "@/stores/use-asset-store";

const imageAsset: NewAsset = {
    kind: "image",
    title: "画布生成结果",
    coverUrl: "https://example.com/image.png",
    tags: [],
    data: { dataUrl: "https://example.com/image.png", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
};

describe("asset library membership", () => {
    test("technical assets stay outside the personal library until explicitly saved", () => {
        expect(isAssetSavedToLibrary(imageAsset)).toBe(false);
        const saved = saveAssetToLibrary(imageAsset, "2026-09-23T08:30:00.000Z");
        expect(isAssetSavedToLibrary(saved)).toBe(true);
        expect(saved.librarySavedAt).toBe("2026-09-23T08:30:00.000Z");
    });
});
