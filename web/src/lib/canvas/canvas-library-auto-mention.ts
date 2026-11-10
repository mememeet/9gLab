import { buildAssetMentionReferences, canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Asset } from "@/stores/use-asset-store";

export async function collectLibraryAssetsForMatching(localAssets: Asset[], loadPage: (page: number) => Promise<{ assets: Asset[]; hasMore: boolean }>) {
    const byId = new Map(localAssets.map((asset) => [asset.id, asset]));
    for (let page = 1; ; page++) {
        const result = await loadPage(page);
        for (const asset of result.assets) byId.set(asset.id, asset);
        if (!result.hasMore) return [...byId.values()];
    }
}

/** Match library and connected resource names, leaving existing mentions and ambiguous names untouched. */
export function autoMentionLibraryAssets(prompt: string, assets: Asset[], connectedReferences: CanvasResourceReference[]) {
    const byName = new Map<string, CanvasResourceReference[]>();
    const references = buildAssetMentionReferences(assets.filter((asset) => asset.status !== "archived"));
    const connected = connectedReferences.filter((reference) => reference.active && !reference.assetId && reference.kind !== "skill" && reference.kind !== "tool");
    for (const reference of [...references, ...connected]) {
        const name = reference.title.trim();
        if (!name) continue;
        byName.set(name, [...(byName.get(name) || []), reference]);
    }
    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    if (!names.length) return { prompt, assetIds: [] as string[], conflictAssetIds: [] as string[], matchedCount: 0, conflicts: [] as string[], occurrences: 0 };

    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![A-Za-z0-9_@])(${names.map(escape).join("|")})(?![A-Za-z0-9_])`, "gu");
    const ids = new Set<string>();
    const conflictIds = new Set<string>();
    const matched = new Set<string>();
    const conflicts = new Set<string>();
    let occurrences = 0;
    const result = prompt
        .split(/(@\[[^\]]+\]|@(?:图片|视频|音频|文本|角色|绘图)\d+|@[^\s@,.;:!?，。；：！？、)\]}】）]+)/gu)
        .map((part) => {
            if (part.startsWith("@")) return part;
            return part.replace(pattern, (match, name: string, offset: number, source: string) => {
                const candidates = byName.get(name)!;
                if (candidates.length !== 1) {
                    conflicts.add(name);
                    candidates.forEach((candidate) => {
                        if (candidate.assetId) conflictIds.add(candidate.assetId);
                    });
                    return match;
                }
                const reference = candidates[0];
                if (reference.assetId) ids.add(reference.assetId);
                matched.add(reference.id);
                occurrences++;
                const token = canvasResourceMentionToken(reference);
                const next = source[offset + match.length];
                const needsSpace = next && !token.startsWith("@[") && (/\d$/u.test(token) ? /\d/u.test(next) : !/[\s,.!?;:，。！？；：、)\]}】）]/u.test(next));
                return `${token}${needsSpace ? " " : ""}`;
            });
        })
        .join("");
    return { prompt: result, assetIds: [...ids], conflictAssetIds: [...conflictIds], matchedCount: matched.size, conflicts: [...conflicts], occurrences };
}
