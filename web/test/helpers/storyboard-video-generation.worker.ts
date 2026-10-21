import { mock } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createCanvasNode, createStoryboardRow } from "../../src/lib/canvas/canvas-project-domain";
import { readNodeGenerationSpec } from "../../src/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";

self.onmessage = async (event) => {
    try {
        const scenario = event.data as string;
        const confirmations: string[] = [];
        mock.module("antd", () => ({
            App: {
                useApp: () => ({
                    message: { success() {}, warning() {}, info() {} },
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
        const configState = { ...config.useConfigStore.getState(), isAiConfigReady: () => true };
        mock.module("../../src/stores/use-config-store", () => ({
            ...config,
            useEffectiveConfig: () => config.defaultConfig,
            useConfigStore: (selector: (state: unknown) => unknown) => selector(configState),
        }));
        const { useCanvasStoryboard } = await import("../../src/pages/canvas/use-canvas-storyboard");
        const image = createCanvasNode(CanvasNodeType.Image, { x: 500, y: 0 }, { content: "/api/resources/frame" });
        const video = createCanvasNode(CanvasNodeType.Video, { x: 900, y: 0 }, { prompt: "运镜短句", seconds: "10", status: "error", taskId: "failed-task", taskStatus: "failed" });
        video.metadata = { ...video.metadata, generationSpec: readNodeGenerationSpec(video) };
        const row = createStoryboardRow(12, {
            id: "row",
            durationSeconds: 5,
            imageNodeId: image.id,
            videoNodeId: video.id,
            plotDescription: "父亲提水桶出阳台。",
            dialogue: "女儿：爸？",
            performanceBlocking: "女儿转身看见父亲。",
            timeBeats: "0-2秒提桶，2-5秒反应与对白。",
            videoMotionPrompt: "运镜短句",
        });
        const script = createCanvasNode(CanvasNodeType.Script, { x: 0, y: 0 }, { storyboard: { rows: [row], visibleColumns: ["videoMotionPrompt"], referenceNodeIds: [] } });
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
        if (scenario === "create") actions!.createScriptVideoNodes(script.id, true, [row.id]);
        else if (scenario === "first-frame") await actions!.generateScriptVideos(script.id, [row.id]);
        else await actions!.createAndGenerateScriptVideos(script.id, [row.id]);
        const result = nodesRef.current.find((node) => node.id === video.id) as CanvasNodeData;
        self.postMessage({
            metadata: result.metadata,
            spec: readNodeGenerationSpec(result),
            queued,
            confirmations,
            expectedFields: [row.plotDescription, row.dialogue, row.performanceBlocking, row.timeBeats, row.videoMotionPrompt],
            imageId: image.id,
            videoId: video.id,
        });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.stack : String(error) });
    }
};
