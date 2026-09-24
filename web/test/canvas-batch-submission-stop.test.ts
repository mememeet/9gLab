import { expect, test } from "bun:test";
import { generationBatchStatus, interruptedBatchSubmission } from "../src/lib/canvas/canvas-generation-batch";
import { CanvasNodeType, type CanvasGenerationBatch, type CanvasGenerationBatchItem, type CanvasNodeData } from "../src/types/canvas";

const item: CanvasGenerationBatchItem = { id: "item", nodeId: "video", status: "submitting", retryCount: 0 };
const node: CanvasNodeData = { id: "video", title: "镜头 1", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { status: "idle" } };

test("首帧读取失败后不回到等待队列，不形成自动重复提交", () => {
    const patch = interruptedBatchSubmission(item, node, false);
    expect(patch?.status).toBe("failed");
    expect(patch?.errorDetails).toContain("停止自动重试");
    const stopped = { ...item, ...patch };
    expect(interruptedBatchSubmission(stopped, node, false)).toBeNull();
    expect(generationBatchStatus({ items: [stopped] } as CanvasGenerationBatch)).toBe("partial_failed");
});

test("请求仍在执行或已获得任务号时保留原有任务追踪", () => {
    expect(interruptedBatchSubmission(item, node, true)).toBeNull();
    expect(interruptedBatchSubmission(item, { ...node, metadata: { taskId: "task-created" } }, false)).toBeNull();
    expect(interruptedBatchSubmission({ ...item, status: "waiting" }, node, false)).toBeNull();
});

test("响应丢失时标记费用不确定，手动重试仍需核对而不是默认未计费", () => {
    expect(interruptedBatchSubmission(item, node, false)?.costUncertain).toBe(true);
});
