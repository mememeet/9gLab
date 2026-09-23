import type { Asset, NewAsset } from "@/stores/use-asset-store";

export function isAssetSavedToLibrary(asset: Pick<Asset, "librarySavedAt">) {
    return Boolean(asset.librarySavedAt?.trim());
}

export function saveAssetToLibrary<T extends NewAsset>(asset: T, savedAt = new Date().toISOString()): T & { librarySavedAt: string } {
    return { ...asset, librarySavedAt: savedAt };
}
