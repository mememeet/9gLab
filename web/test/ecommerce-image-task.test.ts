import { expect, test } from "bun:test";
import { ecommerceImageTaskInput } from "../src/services/ecommerce-image-task";

test("电商商品图使用通用任务并保留项目、模型、规格和资源身份", () => {
    const task = ecommerceImageTaskInput({
        ecommerceProjectId: "project-1",
        kind: "image",
        prompt: "商品主图",
        model: "image-model",
        channelId: "channel-1",
        parameters: { size: "1024x1024", count: 1 },
        references: [{ resourceId: "resource-1", kind: "image", role: "reference" }],
    });
    expect(task).toMatchObject({
        projectId: "project-1",
        type: "canvas_image",
        operation: "image",
        model: "image-model",
        input: {
            config: { channelId: "channel-1", size: "1024x1024", count: 1 },
            metadata: { source: "ecommerce-agent", ecommerceProjectId: "project-1" },
            referenceImages: [{ storageKey: "resource:resource-1", role: "reference" }],
        },
    });
});

test("逻辑模型的商品图任务保留能力选项", () => {
    const task = ecommerceImageTaskInput({
        ecommerceProjectId: "project-1", kind: "image", prompt: "主图", model: "logical", logicalModelId: "model-1",
        parameters: { imageResolution: "2k", count: 1 }, references: [],
    });
    expect(task.logicalModelId).toBe("model-1");
    expect(task.input?.capabilityOptions).toEqual({ imageResolution: "2k", count: 1 });
});
