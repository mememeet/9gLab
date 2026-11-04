import { resourceStorageKey } from "@/services/api/resources";
import { createGenerationTask, type CreateTaskInput } from "@/services/api/task-center";

export type EcommerceImageTaskRequest = {
    ecommerceProjectId: string;
    kind: "image";
    prompt: string;
    model: string;
    logicalModelId?: string;
    channelId?: string;
    parameters: Record<string, unknown>;
    references: Array<{ resourceId: string; kind: "image"; role: "reference" }>;
};

export function ecommerceImageTaskInput(request: EcommerceImageTaskRequest): CreateTaskInput {
    return {
        projectId: request.ecommerceProjectId,
        type: "canvas_image",
        operation: "image",
        prompt: request.prompt,
        model: request.model,
        ...(request.logicalModelId ? { logicalModelId: request.logicalModelId } : {}),
        input: {
            mode: "image",
            prompt: request.prompt,
            config: { ...request.parameters, model: request.model, ...(request.channelId ? { channelId: request.channelId } : {}) },
            capabilityOptions: request.logicalModelId ? request.parameters : undefined,
            metadata: { source: "ecommerce-agent", ecommerceProjectId: request.ecommerceProjectId },
            referenceImages: request.references.map((reference) => ({ id: reference.resourceId, name: "商品参考图", type: "image", dataUrl: "", storageKey: resourceStorageKey(reference.resourceId), role: reference.role })),
        },
    };
}

export function createEcommerceImageTask(request: EcommerceImageTaskRequest) {
    return createGenerationTask(ecommerceImageTaskInput(request));
}
