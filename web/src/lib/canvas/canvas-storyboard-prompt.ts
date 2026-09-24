import { storyboardRowsOutputContract } from "./canvas-project-domain";
import type { StoryboardAssetCatalogItem } from "./canvas-storyboard-assets";
import type { StoryboardGenerationContext } from "./canvas-storyboard-context";

type CanvasStoryboardPromptInput = StoryboardGenerationContext & {
    prompt: string;
    canvasAssets: StoryboardAssetCatalogItem[];
    shotCount: number;
    shotDurationSeconds: number;
};

// canvas_text only sends prompt to the model. Context in task input alone is not
// model-visible; include both the production context and the editable-row contract.
export function buildCanvasStoryboardPrompt(input: CanvasStoryboardPromptInput): string {
    const count = Number.isInteger(input.shotCount) && input.shotCount > 0 ? input.shotCount : 0;
    const duration = Number.isInteger(input.shotDurationSeconds) && input.shotDurationSeconds > 0 && input.shotDurationSeconds <= 60 ? input.shotDurationSeconds : 0;
    const requirements = [
        count ? `rows 必须恰好 ${count} 项，完整覆盖剧情。` : "自动确定镜头数量，完整覆盖剧情。",
        duration ? `每项 durationSeconds 固定为 ${duration}。` : "根据动作和台词合理安排每镜时长（1-60 秒）。",
    ].join(" ");
    return [
        input.prompt,
        "【项目画风】",
        JSON.stringify(input.projectStyle),
        "【已确认角色版本】",
        JSON.stringify(input.characters),
        "【可用画布资产】",
        JSON.stringify(input.canvasAssets),
        "沿用项目画风与角色定义，将必要的角色外观、环境、动作和镜头设计写入对应图片及视频提示词。不要虚构已有资产或角色版本。",
        storyboardRowsOutputContract(requirements),
    ].join("\n\n");
}
