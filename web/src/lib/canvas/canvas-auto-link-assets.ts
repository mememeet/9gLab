import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { applyCanvasConnectionPromptSync, buildCanvasNodeMentionReferenceMap } from "@/lib/canvas/canvas-resource-references";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/** Prepare the complete graph before publishing any nodes, edges or prompt changes. */
export async function prepareCanvasAssetLinks(options: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    targetId: string;
    prompt: string;
    assetIds: string[];
    config: AiConfig;
    createNode: (assetId: string, index: number) => Promise<CanvasNodeData>;
    createId: () => string;
}) {
    const { nodes, connections, targetId, config } = options;
    const target = nodes.find((node) => node.id === targetId);
    if (!target || target.metadata?.locked) throw new Error("目标节点不存在或已锁定");
    const configId = connections.find((edge) => edge.fromNodeId === targetId && nodes.find((node) => node.id === edge.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId;
    const configInputs = configId ? buildCanvasNodeMentionReferenceMap(nodes, connections).get(configId) || [] : [];
    const receiverId = configId && configInputs.some((reference) => reference.nodeId !== targetId) ? configId : targetId;
    if (nodes.find((node) => node.id === receiverId)?.metadata?.locked) throw new Error("目标配置节点已锁定，无法关联素材");
    const reaches = (from: string, destination: string) => {
        const pending = [from];
        const seen = new Set<string>();
        while (pending.length) {
            const id = pending.pop()!;
            if (id === destination) return true;
            if (seen.has(id)) continue;
            seen.add(id);
            connections.filter((edge) => edge.fromNodeId === id).forEach((edge) => pending.push(edge.toNodeId));
        }
        return false;
    };
    const created: CanvasNodeData[] = [];
    const sourceByAsset = new Map<string, string>();
    let nextConnections = [...connections];
    for (const assetId of new Set(options.assetIds)) {
        const candidates = nodes.filter((node) => node.id !== targetId && (node.metadata?.assetId === assetId || node.metadata?.characterAssetId === assetId) && !reaches(receiverId, node.id));
        let source = candidates.find((node) => nextConnections.some((edge) => edge.fromNodeId === node.id && edge.toNodeId === receiverId)) || candidates[0];
        if (!source) {
            source = await options.createNode(assetId, created.length);
            const occupied = [...nodes, ...created];
            let position: CanvasNodeData["position"] | undefined;
            for (let attempt = 0; attempt < 200; attempt++) {
                const row = attempt % 10;
                const offset = row === 0 ? 0 : (row % 2 ? 1 : -1) * Math.ceil(row / 2);
                const candidate = { x: target.position.x - source.width - 120 - Math.floor(attempt / 10) * (source.width + 120), y: target.position.y + offset * (source.height + 80) };
                const overlaps = occupied.some(
                    (node) => candidate.x < node.position.x + node.width + 32 && candidate.x + source!.width + 32 > node.position.x && candidate.y < node.position.y + node.height + 32 && candidate.y + source!.height + 32 > node.position.y,
                );
                if (!overlaps) {
                    position = candidate;
                    break;
                }
            }
            if (!position) throw new Error("画布上没有找到合适的位置放置素材");
            source = { ...source, position };
            created.push(source);
        }
        const edge = { fromNodeId: source.id, toNodeId: receiverId };
        if (!nextConnections.some((item) => item.fromNodeId === edge.fromNodeId && item.toNodeId === edge.toNodeId)) {
            const error = canvasConnectionError(config, [...nodes, ...created], nextConnections, edge);
            if (error) throw new Error(`素材「${source.title}」无法连线：${error}`);
            nextConnections = [...nextConnections, { id: options.createId(), ...edge }];
        }
        sourceByAsset.set(assetId, source.id);
    }
    let nextNodes = applyCanvasConnectionPromptSync(nodes, connections, [...nodes.map((node) => (node.id === targetId ? writeCanvasNodePrompt(node, options.prompt) : node)), ...created], nextConnections);
    const refs = buildCanvasNodeMentionReferenceMap(nextNodes, nextConnections).get(targetId) || [];
    let prompt = nodeGenerationPrompt(nextNodes.find((node) => node.id === targetId)!);
    for (const [assetId, sourceId] of sourceByAsset) {
        const reference = refs.find((item) => item.nodeId === sourceId);
        if (!reference) throw new Error("素材连线未能成为节点参考，请检查画布连接");
        const token = `@[asset:${assetId}]`;
        const parts = prompt.split(token);
        prompt = parts.map((part, index) => (index === 0 ? part : `@${reference.label}${/^\d/u.test(part) ? " " : ""}${part}`)).join("");
    }
    nextNodes = nextNodes.map((node) => (node.id === targetId ? writeCanvasNodePrompt(node, prompt) : node));
    return { nodes: nextNodes, connections: nextConnections, prompt, created };
}
