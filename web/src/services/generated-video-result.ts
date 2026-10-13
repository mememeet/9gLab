import { resolveVideoMediaUrl, type UploadedFile } from "@/services/file-storage";
import { getCachedResourceBlob } from "@/services/resource-blob-cache";

export type GeneratedRemoteVideoResult = {
    dataUrl?: string;
    storageKey: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
    mimeType?: string;
};

type GeneratedRemoteVideoDependencies = {
    resolveUrl: (storageKey: string, fallback?: string) => Promise<string>;
    cacheBlob: (storageKey: string) => Promise<Blob | null>;
};

const generatedRemoteVideoDependencies: GeneratedRemoteVideoDependencies = {
    resolveUrl: resolveVideoMediaUrl,
    cacheBlob: getCachedResourceBlob,
};

/**
 * A persisted platform resource is already the durable generation result.
 * Browser Blob caching is only a performance optimization and may be blocked
 * by an object-store CORS policy, so it must never turn a completed task into
 * a failed Canvas node.
 */
export async function prepareGeneratedRemoteVideo(result: GeneratedRemoteVideoResult, dependencies: GeneratedRemoteVideoDependencies = generatedRemoteVideoDependencies): Promise<UploadedFile> {
    const url = await dependencies.resolveUrl(result.storageKey, result.dataUrl || "");
    if (!url) throw new Error("生成视频资源地址为空，未标记为成功");
    void dependencies.cacheBlob(result.storageKey).catch((error) => {
        console.warn("生成视频本地缓存失败，继续使用服务端资源", { storageKey: result.storageKey, error });
    });
    return {
        url,
        storageKey: result.storageKey,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
        bytes: result.bytes || 0,
        mimeType: result.mimeType || "video/mp4",
    };
}
