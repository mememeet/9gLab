import { mock } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createCanvasNode, createStoryboardRow } from "../../src/lib/canvas/canvas-project-domain";
import { readNodeGenerationSpec } from "../../src/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";
import { buildNodeGenerationContext } from "../../src/components/canvas/canvas-node-generation";
import { defaultModelCapabilityConfig } from "../../src/lib/model-capabilities";

self.onmessage = async (event) => {
    try {
        const scenario = event.data as string;
        const confirmations: string[] = [];
        const warnings: string[] = [];
        mock.module("antd", () => ({
            App: {
                useApp: () => ({
                    message: {
                        success() {},
                        warning(value: string) {
                            warnings.push(value);
                        },
                        info() {},
                    },
                    modal: {
                        confirm: (options: { title: string; onOk: () => void; onCancel: () => void }) => {
                            confirmations.push(options.title);
                            if (scenario === "cancel") options.onCancel();
                            else options.onOk();
                        },
                    },
                }),
            },
        }));
        const config = await import("../../src/stores/use-config-store");
        const longVideoCapability = defaultModelCapabilityConfig(undefined, "long-video");
        longVideoCapability.video!.duration = { selection: "range", min: 1, max: 30, step: 1, default: 6 };
        const effectiveConfig =
            scenario === "merged-18"
                ? {
                      ...config.defaultConfig,
                      model: "long-video",
                      videoModel: "long-video",
                      videoModels: ["long-video"],
                      channels: [
                          {
                              id: "test",
                              name: "test",
                              baseUrl: "",
                              apiKey: "",
                              apiFormat: "openai" as const,
                              models: ["long-video"],
                              modelCosts: [{ model: "long-video", capability: "video" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 0, capabilityConfig: longVideoCapability }],
                          },
                      ],
                  }
                : config.defaultConfig;
        const configState = { ...config.useConfigStore.getState(), isAiConfigReady: () => true };
        mock.module("../../src/stores/use-config-store", () => ({
            ...config,
            useEffectiveConfig: () => effectiveConfig,
            useConfigStore: (selector: (state: unknown) => unknown) => selector(configState),
        }));
        const { useCanvasStoryboard } = await import("../../src/pages/canvas/use-canvas-storyboard");
        const image = createCanvasNode(CanvasNodeType.Image, { x: 500, y: 0 }, { content: "/api/resources/frame" });
        const video = createCanvasNode(CanvasNodeType.Video, { x: 900, y: 0 }, { prompt: "运镜短句", seconds: "10", status: "error", taskId: "failed-task", taskStatus: "failed" });
        video.metadata = { ...video.metadata, generationSpec: readNodeGenerationSpec(video) };
        const row = createStoryboardRow(12, {
            id: "row",
            durationSeconds: scenario === "merged-18" ? 6 : 5,
            imageNodeId: image.id,
            videoNodeId: video.id,
            plotDescription: "父亲提水桶出阳台。",
            dialogue: "女儿：爸？",
            performanceBlocking: "女儿转身看见父亲。",
            timeBeats: "0-2秒提桶，2-5秒反应与对白。",
            videoMotionPrompt: "运镜短句",
        });
        const secondRow = createStoryboardRow(13, { id: "row-2", durationSeconds: scenario === "merged-unsupported" ? 11 : scenario === "merged-18" ? 6 : 5, plotDescription: "女儿拥抱父亲。", dialogue: "女儿：我来帮你。" });
        const thirdRow = createStoryboardRow(14, { id: "row-3", durationSeconds: 6, plotDescription: "父亲放下水桶。", dialogue: "父亲：谢谢。" });
        const script = createCanvasNode(
            CanvasNodeType.Script,
            { x: 0, y: 0 },
            { storyboard: { rows: scenario === "merged-18" ? [row, secondRow, thirdRow] : scenario.startsWith("merged") ? [row, secondRow] : [row], visibleColumns: ["videoMotionPrompt"], referenceNodeIds: [] } },
        );
        const nodesRef = { current: [script, image, video] };
        const connectionsRef = { current: [] };
        const queued: unknown[] = [];
        let actions: ReturnType<typeof useCanvasStoryboard>;
        function Harness() {
            actions = useCanvasStoryboard({
                projectId: "canvas",
                addedSkills: [],
                nodesRef,
                connectionsRef,
                setNodes: (next) => {
                    nodesRef.current = typeof next === "function" ? next(nodesRef.current) : next;
                },
                setConnections: () => undefined,
                setSelectedNodeIds: () => undefined,
                enqueueGenerationBatch: (_source, mode, targets) => {
                    queued.push({ mode, targets });
                    return "batch";
                },
            });
            return null;
        }
        renderToString(createElement(Harness));
        let mergedRowId: string | undefined;
        if (scenario.startsWith("merged")) {
            mergedRowId = actions!.changeMergedRows(script.id, scenario === "merged-18" ? [row.id, secondRow.id, thirdRow.id] : [row.id, secondRow.id]);
            if (!mergedRowId) throw new Error("merge failed");
            await actions!.createAndGenerateScriptVideos(script.id, [mergedRowId]);
        } else if (scenario === "create") actions!.createScriptVideoNodes(script.id, true, [row.id]);
        else if (scenario === "first-frame") await actions!.generateScriptVideos(script.id, [row.id]);
        else await actions!.createAndGenerateScriptVideos(script.id, [row.id]);
        const mergedRow = nodesRef.current.find((node) => node.id === script.id)?.metadata?.storyboard?.rows.find((item) => item.id === mergedRowId);
        const result = nodesRef.current.find((node) => node.id === (mergedRow?.videoNodeId || video.id)) as CanvasNodeData;
        const generationContext = scenario === "merged" || scenario === "merged-18" ? buildNodeGenerationContext(result.id, nodesRef.current, connectionsRef.current, result.metadata?.composerContent || "", []) : undefined;
        self.postMessage({
            metadata: result.metadata,
            spec: readNodeGenerationSpec(result),
            queued,
            confirmations,
            expectedFields: [row.plotDescription, row.dialogue, row.performanceBlocking, row.timeBeats, row.videoMotionPrompt],
            imageId: image.id,
            videoId: video.id,
            mergedRowId,
            mergedVideoId: mergedRow?.videoNodeId,
            warnings,
            generationContext,
        });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.stack : String(error) });
    }
};
