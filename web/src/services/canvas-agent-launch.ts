import { localForageStorageForScope } from "@/lib/localforage-storage";
import { canvasSkillMentionToken } from "@/lib/canvas/canvas-resource-references";
import { getActiveUserScope } from "@/lib/user-scope";

export type CanvasAgentLaunchMode = "agent" | "video" | "image" | "text";

export type CanvasAgentLaunchIntent = {
    version: 1;
    id: string;
    canvasId: string;
    prompt: string;
    mode: CanvasAgentLaunchMode;
    targetModel: {
        value: string;
        displayName: string;
        logicalModelId?: string;
        channelId?: string;
        channelModelKey?: string;
    };
    settings?: {
        ratio?: string;
        seconds?: string;
        quality?: string;
        videoQuality?: string;
        count?: string;
    };
    skillIds: string[];
    assetIds: string[];
    createdAt: string;
};

const STORAGE_PREFIX = "canvas-agent-launch-v1";

export async function saveCanvasAgentLaunch(intent: CanvasAgentLaunchIntent) {
    assertCanvasAgentLaunch(intent);
    await localForageStorageForScope(getActiveUserScope()).setItem(storageKey(intent.id), JSON.stringify(intent));
}

export async function loadCanvasAgentLaunch(id: string): Promise<CanvasAgentLaunchIntent | null> {
    if (!id.trim()) return null;
    const value = await localForageStorageForScope(getActiveUserScope()).getItem(storageKey(id));
    if (!value) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("首页创作请求已损坏，请返回首页重新发起");
    }
    assertCanvasAgentLaunch(parsed);
    return parsed;
}

export async function clearCanvasAgentLaunch(id: string) {
    if (!id.trim()) return;
    await localForageStorageForScope(getActiveUserScope()).removeItem(storageKey(id));
}

export function buildCanvasAgentLaunchPrompt(intent: CanvasAgentLaunchIntent) {
    const modeLabel = intent.mode === "video" ? "视频" : intent.mode === "image" ? "图片" : intent.mode === "text" ? "文本" : "综合创作";
    const settings = intent.mode === "video"
        ? [intent.settings?.ratio, intent.settings?.seconds ? `${intent.settings.seconds} 秒` : "", intent.settings?.videoQuality ? `${intent.settings.videoQuality}p` : ""]
        : intent.mode === "image"
            ? [intent.settings?.ratio, intent.settings?.quality, intent.settings?.count ? `${intent.settings.count} 张` : ""]
            : [];
    const specifications = settings.filter(Boolean).join(" · ");
    const references = intent.assetIds.length ? `\n参考素材：已放入当前画布，共 ${intent.assetIds.length} 个，请结合这些素材节点。` : "";
    const skills = intent.skillIds.map(canvasSkillMentionToken).join(" ");
    const selection = intent.targetModel.logicalModelId
        ? `logicalModelId=${intent.targetModel.logicalModelId}`
        : intent.targetModel.channelId && intent.targetModel.channelModelKey
            ? `channelId=${intent.targetModel.channelId}, channelModelKey=${intent.targetModel.channelModelKey}`
            : `model=${intent.targetModel.value}`;
    const modelInstruction = intent.mode === "agent"
        ? `请作为画布 Agent 协作完成，当前 Agent 模型为「${intent.targetModel.displayName}」。`
        : `目标是${modeLabel}创作；需要生成内容时，先用 model_list 核对并使用模型「${intent.targetModel.displayName}」的同一 selection（${selection}）。`;
    return [
        intent.prompt.trim(),
        "",
        modelInstruction,
        specifications ? `创作规格：${specifications}。` : "",
        references.trim(),
        skills,
    ].filter(Boolean).join("\n");
}

function storageKey(id: string) {
    return `${STORAGE_PREFIX}:${encodeURIComponent(id)}`;
}

function assertCanvasAgentLaunch(value: unknown): asserts value is CanvasAgentLaunchIntent {
    if (!value || typeof value !== "object") throw new Error("首页创作请求格式无效");
    const intent = value as Partial<CanvasAgentLaunchIntent>;
    if (intent.version !== 1
        || typeof intent.id !== "string" || intent.id.length < 8
        || typeof intent.canvasId !== "string" || !intent.canvasId
        || typeof intent.prompt !== "string" || !intent.prompt.trim()
        || !["agent", "video", "image", "text"].includes(intent.mode || "")
        || !intent.targetModel || typeof intent.targetModel.value !== "string" || !intent.targetModel.value
        || typeof intent.targetModel.displayName !== "string" || !intent.targetModel.displayName
        || (intent.targetModel.logicalModelId !== undefined && typeof intent.targetModel.logicalModelId !== "string")
        || (intent.targetModel.channelId !== undefined && typeof intent.targetModel.channelId !== "string")
        || (intent.targetModel.channelModelKey !== undefined && typeof intent.targetModel.channelModelKey !== "string")
        || !Array.isArray(intent.skillIds) || !intent.skillIds.every((id) => typeof id === "string")
        || !Array.isArray(intent.assetIds) || !intent.assetIds.every((id) => typeof id === "string")
        || typeof intent.createdAt !== "string") {
        throw new Error("首页创作请求格式无效");
    }
}
