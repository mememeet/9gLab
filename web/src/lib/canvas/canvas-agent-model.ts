import { modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

// The default is resolved from the live catalog, never from an invented option.
export function resolveAgentTextModel(config: AiConfig): string {
    const options = selectableModelsByCapability(config, "text").filter((value) => resolveModelChannel(config, value).enabled !== false);
    if (config.agentTextModel) {
        if (!options.includes(config.agentTextModel)) throw new Error("所选 Agent 文本模型不可用，请重新选择；不会自动切换到其他模型。");
        return config.agentTextModel;
    }
    const model = options.find((value) => resolveModelChannel(config, value).scope === "system" && /^deepseek-v4-pro(?:-|$)/i.test(modelOptionName(value)));
    if (!model) throw new Error("平台默认 DeepSeek V4 尚未配置或已停用，请联系管理员，或选择个人文本模型。");
    return model;
}
