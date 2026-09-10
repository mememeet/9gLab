import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentTextModel } from "../src/lib/canvas/canvas-agent-model";
import { buildBackendToolRequests } from "../src/services/api/image";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { buildToolAgentMessages } from "../src/components/canvas/canvas-assistant-panel";
import { CanvasNodeType } from "../src/types/canvas";

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

test("DeepSeek tool follow-up keeps the result and disables reasoning that the loop cannot replay", () => {
    const messages = [
        { role: "user" as const, content: "读取画布" },
        { type: "function_call" as const, call_id: "call-1", name: "canvas_get_context", arguments: "{}" },
        { role: "tool" as const, tool_call_id: "call-1", content: '{"nodeCount":0}' },
    ];
    const requests = buildBackendToolRequests(messages, [], "auto", { ...config, model: `platform::${deepseek}` });
    assert.deepEqual(requests.chatCompletion.thinking, { type: "disabled" });
    assert.deepEqual((requests.chatCompletion.messages as unknown[]).at(-1), { role: "tool", tool_call_id: "call-1", content: '{"nodeCount":0}' });
    assert.equal(buildBackendToolRequests(messages, [], "auto", { ...config, model: "personal::other-text-model" }).chatCompletion.thinking, undefined);
});

test("text-only Agent keeps the explicitly referenced node identity without sending image pixels", async () => {
    const messages = await buildToolAgentMessages(
        { projectId: "qa", title: "QA", nodes: [], connections: [], selectedNodeIds: ["selected-but-not-referenced"], viewport: { x: 0, y: 0, k: 1 } },
        [],
        { id: "message", role: "user", text: "请用这张参考图生成视频", references: [{ id: "explicit-image", type: CanvasNodeType.Image, title: "白色店员", dataUrl: "data:image/png;base64,TEST_PIXELS" }] },
        [], { ...config, model: `platform::${deepseek}` },
    );
    const last = messages.at(-1)!;
    assert.ok("content" in last && Array.isArray(last.content));
    assert.ok(last.content.every((part) => part.type === "text"));
    assert.ok(JSON.stringify(last).includes("节点 ID=explicit-image"));
    assert.ok(!JSON.stringify(last).includes("TEST_PIXELS"));
    assert.ok(JSON.stringify(messages[0]).includes("选中节点仅表示界面选区"));
});
