import { describe, expect, test } from "bun:test";

import { prepareGeneratedRemoteVideo } from "@/services/generated-video-result";

describe("prepareGeneratedRemoteVideo", () => {
    test("keeps a completed platform video successful when browser Blob caching fails", async () => {
        const cached: string[] = [];
        const result = await prepareGeneratedRemoteVideo(
            {
                dataUrl: "/api/resources/resource-1/file",
                storageKey: "resource:resource-1",
                width: 1280,
                height: 720,
                durationMs: 6060,
                bytes: 3_614_812,
                mimeType: "video/mp4",
            },
            {
                resolveUrl: async () => "https://cdn.example.test/video.mp4",
                cacheBlob: async (storageKey) => {
                    cached.push(storageKey);
                    throw new TypeError("Failed to fetch");
                },
            },
        );

        expect(result).toEqual({
            url: "https://cdn.example.test/video.mp4",
            storageKey: "resource:resource-1",
            width: 1280,
            height: 720,
            durationMs: 6060,
            bytes: 3_614_812,
            mimeType: "video/mp4",
        });
        expect(cached).toEqual(["resource:resource-1"]);
        await Promise.resolve();
    });

    test("still rejects a completed result without a usable resource URL", async () => {
        await expect(prepareGeneratedRemoteVideo({ storageKey: "resource:missing" }, { resolveUrl: async () => "", cacheBlob: async () => null })).rejects.toThrow("生成视频资源地址为空");
    });
});
