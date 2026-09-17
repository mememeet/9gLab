import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentTextModel } from "../src/lib/canvas/canvas-agent-model";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";

const deepseek = "deepseek-v4-pro-ga-260813";
const platform = createModelChannel({
    id: "platform", scope: "system", name: "平台", apiKey: "backend-system-channel", baseUrl: "/api/provider",
    models: ["01-a", deepseek],
    modelCosts: [
        { model: "01-a", capability: "video", protocol: "seedance-videos-compatible", billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000 },
        { model: deepseek, capability: "text", protocol: "chat-completion", billingMode: "token", unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 9_000_000, outputTokenPriceMicrocredits: 27_000_000, cachedTokenPriceMicrocredits: 300_000 },
    ],
});
const config: AiConfig = { ...defaultConfig, channels: [platform], model: "platform::01-a", videoModel: "platform::01-a", textModel: "" };

test("Agent default resolves a live platform DeepSeek independently of the canvas video model", () => {
    assert.equal(resolveAgentTextModel(config), `platform::${deepseek}`);
    assert.equal(config.model, "platform::01-a");
    assert.equal(config.textModel, "");
});

test("missing or disabled default never falls back to the media model or a personal key", () => {
    assert.throws(() => resolveAgentTextModel({ ...config, channels: [{ ...platform, models: ["01-a"] }] }), /尚未配置或已停用/);
    assert.throws(() => resolveAgentTextModel({ ...config, channels: [{ ...platform, enabled: false }] }), /尚未配置或已停用/);
    assert.throws(() => resolveAgentTextModel({ ...config, channels: [{ ...platform, scope: "user" }] }), /尚未配置或已停用/);
});

test("explicit unavailable or video Agent choice fails instead of silently changing models", () => {
    assert.throws(() => resolveAgentTextModel({ ...config, agentTextModel: "removed::text-model" }), /不会自动切换/);
    assert.throws(() => resolveAgentTextModel({ ...config, agentTextModel: "platform::01-a" }), /不会自动切换/);
    assert.equal(resolveAgentTextModel({ ...config, agentTextModel: `platform::${deepseek}` }), `platform::${deepseek}`);
});
