import { nanoid } from "nanoid";

import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { canvasNodeMentionToken } from "@/lib/canvas/canvas-resource-references";
import { storyboardVideoPrompt } from "@/lib/canvas/canvas-storyboard-video-prompt";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";

function rowConnection(connection: CanvasConnection, scriptId: string, rowIds: Set<string>, outputIds: Set<string>) {
    return Boolean(
        (connection.storyboardRowId && rowIds.has(connection.storyboardRowId) && (connection.fromNodeId === scriptId || connection.toNodeId === scriptId || outputIds.has(connection.toNodeId))) ||
        (connection.fromNodeId === scriptId && connection.fromHandleId?.startsWith("row:") && rowIds.has(connection.fromHandleId.slice(4))) ||
        (connection.toNodeId === scriptId && connection.toHandleId?.startsWith("row:") && rowIds.has(connection.toHandleId.slice(4))),
    );
}

export function mergeStoryboardRows(rows: StoryboardRow[], connections: CanvasConnection[], scriptId: string, selectedIds: string[], nodes: CanvasNodeData[] = []) {
    const selected = new Set(selectedIds);
    const indexes = rows.flatMap((row, index) => (selected.has(row.id) ? [index] : []));
    if (indexes.length < 2 || indexes.length !== selected.size) throw new Error("请选择至少两个镜头");
    if (indexes[indexes.length - 1] - indexes[0] + 1 !== indexes.length) throw new Error("只能合并相邻的镜头");
    const originals = indexes.map((index) => rows[index]);
    const readyImageIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content || node.metadata?.storageKey)).map((node) => node.id));
    if (originals.some((row) => !Number.isInteger(row.durationSeconds) || row.durationSeconds < 1)) throw new Error("镜头时长必须为正整数");
    const durationSeconds = originals.reduce((total, row) => total + row.durationSeconds, 0);
    if (durationSeconds > 30) throw new Error("合并后的总时长不能超过 30 秒");

    let elapsed = 0;
    const segments = originals.map((row) => {
        const label = `${elapsed}–${elapsed + row.durationSeconds} 秒（原镜头 ${row.shotNumber}）`;
        elapsed += row.durationSeconds;
        return { row, label };
    });
    const assetBindings = Array.from(
        new Map(
            originals.flatMap((row) => [...(row.assetBindings || []), ...(row.imageNodeId && readyImageIds.has(row.imageNodeId) ? [{ nodeId: row.imageNodeId, role: "style" as const, priority: 60 }] : [])]).map((binding) => [binding.nodeId, binding]),
        ).values(),
    );
    const characters = Array.from(new Map(originals.flatMap((row) => row.characters || []).map((character) => [character.characterAssetId || character.characterName, character])).values());
    const outputIds = new Set([
        ...originals.flatMap((row) => [row.imageNodeId, row.videoNodeId]).filter((id): id is string => Boolean(id)),
        ...connections.filter((connection) => connection.fromNodeId === scriptId && connection.fromHandleId?.startsWith("row:") && selected.has(connection.fromHandleId.slice(4))).map((connection) => connection.toNodeId),
    ]);
    const originalConnections = connections.filter((connection) => rowConnection(connection, scriptId, selected, outputIds));
    const merged = createStoryboardRow(indexes[0] + 1, {
        durationSeconds,
        videoMotionPrompt: segments
            .map(({ row, label }) => {
                const referenceIds = new Set([
                    ...(row.assetBindings || []).map((binding) => binding.nodeId),
                    ...(row.imageNodeId && readyImageIds.has(row.imageNodeId) ? [row.imageNodeId] : []),
                    ...connections.filter((connection) => connection.toNodeId === scriptId && connection.toHandleId === `row:${row.id}`).map((connection) => connection.fromNodeId),
                    ...connections.filter((connection) => row.videoNodeId && connection.toNodeId === row.videoNodeId && connection.fromNodeId !== scriptId).map((connection) => connection.fromNodeId),
                ]);
                return [`【${label}】`, referenceIds.size ? `本段参考素材：${Array.from(referenceIds).map(canvasNodeMentionToken).join(" ")}` : "", storyboardVideoPrompt({ ...row, dialogue: "" })].filter(Boolean).join("\n");
            })
            .join("\n\n"),
        dialogue: segments.flatMap(({ row, label }) => ((row.dialogue || "").trim() ? [`【${label}】${row.dialogue.trim()}`] : [])).join("\n"),
        characters,
        assetBindings,
        mergeOrigin: { rows: originals, connections: originalConnections },
    });
    const nextRows = [...rows.slice(0, indexes[0]), merged, ...rows.slice(indexes[indexes.length - 1] + 1)].map((row, index) => ({ ...row, shotNumber: index + 1 }));
    const nextConnections = connections.filter((connection) => !rowConnection(connection, scriptId, selected, outputIds));
    for (const connection of originalConnections) {
        if (connection.toNodeId !== scriptId || !connection.toHandleId?.startsWith("row:")) continue;
        if (nextConnections.some((item) => item.fromNodeId === connection.fromNodeId && item.toNodeId === scriptId && item.toHandleId === `row:${merged.id}`)) continue;
        nextConnections.push({ ...connection, id: nanoid(), toHandleId: `row:${merged.id}`, storyboardRowId: connection.storyboardRowId ? merged.id : undefined });
    }
    for (const original of originals) {
        for (const connection of connections) {
            if (!original.videoNodeId || connection.toNodeId !== original.videoNodeId || connection.fromNodeId === scriptId) continue;
            if (nextConnections.some((item) => item.fromNodeId === connection.fromNodeId && item.toNodeId === scriptId && item.toHandleId === `row:${merged.id}`)) continue;
            nextConnections.push({ id: nanoid(), fromNodeId: connection.fromNodeId, toNodeId: scriptId, toHandleId: `row:${merged.id}`, storyboardRowId: merged.id });
        }
    }
    return { rows: nextRows, connections: nextConnections, mergedId: merged.id };
}

export function restoreStoryboardRows(rows: StoryboardRow[], connections: CanvasConnection[], scriptId: string, rowId: string, existingNodeIds: Set<string>) {
    const index = rows.findIndex((row) => row.id === rowId);
    const row = rows[index];
    if (!row?.mergeOrigin) throw new Error("该镜头没有可恢复的合并记录");
    const existingRowIds = new Set(rows.filter((item) => item.id !== rowId).map((item) => item.id));
    if (row.mergeOrigin.rows.some((item) => existingRowIds.has(item.id))) throw new Error("原镜头已存在，无法恢复");
    let missingReferences = false;
    const restoredRows = row.mergeOrigin.rows.map((original) => {
        const imageNodeId = original.imageNodeId && existingNodeIds.has(original.imageNodeId) ? original.imageNodeId : undefined;
        const videoNodeId = original.videoNodeId && existingNodeIds.has(original.videoNodeId) ? original.videoNodeId : undefined;
        const assetBindings = (original.assetBindings || []).filter((binding) => existingNodeIds.has(binding.nodeId));
        if ((original.imageNodeId && !imageNodeId) || (original.videoNodeId && !videoNodeId) || assetBindings.length !== (original.assetBindings || []).length) missingReferences = true;
        return { ...original, imageNodeId, videoNodeId, assetBindings };
    });
    const nextRows = [...rows.slice(0, index), ...restoredRows, ...rows.slice(index + 1)].map((item, rowIndex) => ({ ...item, shotNumber: rowIndex + 1 }));
    const outputIds = new Set([row.imageNodeId, row.videoNodeId].filter((id): id is string => Boolean(id)));
    const nextConnections = connections.filter((connection) => !rowConnection(connection, scriptId, new Set([rowId]), outputIds));
    const connectionIds = new Set(nextConnections.map((connection) => connection.id));
    for (const connection of row.mergeOrigin.connections) {
        if (!existingNodeIds.has(connection.fromNodeId) || !existingNodeIds.has(connection.toNodeId)) missingReferences = true;
        if (!connectionIds.has(connection.id) && existingNodeIds.has(connection.fromNodeId) && existingNodeIds.has(connection.toNodeId)) nextConnections.push(connection);
    }
    return { rows: nextRows, connections: nextConnections, missingReferences };
}
