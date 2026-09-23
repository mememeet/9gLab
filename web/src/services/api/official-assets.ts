import type { Asset, AssetCategory } from "@/stores/use-asset-store";
import { compactApiParams, http } from "./request";

export type OfficialAssetStatus = "draft" | "published" | "retired";

export type OfficialAssetMedia = {
    id: string;
    role: string;
    position: number;
    fileUrl: string;
    kind: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
    durationMs: number;
};

export type OfficialAsset = {
    id: string;
    title: string;
    kind: string;
    category: AssetCategory;
    status: OfficialAssetStatus;
    description: string;
    prompt: string;
    tags: string[];
    source: string;
    license: string;
    aiGenerated: boolean;
    sortOrder: number;
    favorite: boolean;
    materialized: boolean;
    useCount: number;
    favoriteCount: number;
    media: OfficialAssetMedia[];
    createdAt: string;
    updatedAt: string;
};

export type OfficialAssetPage = {
    items: OfficialAsset[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export type OfficialAssetListParams = {
    page?: number;
    pageSize?: number;
    q?: string;
    kind?: string;
    category?: string;
    status?: OfficialAssetStatus;
    favorite?: boolean;
};

export type SaveOfficialAssetInput = {
    title: string;
    category: AssetCategory;
    status: OfficialAssetStatus;
    description: string;
    prompt: string;
    tags: string[];
    source: string;
    license: string;
    aiGenerated: boolean;
    sortOrder: number;
    resourceIds?: string[];
};

export function listOfficialAssets(params: OfficialAssetListParams, signal?: AbortSignal) {
    return http.get<OfficialAssetPage>("/official-assets", {
        params: compactApiParams({ ...params, favorite: params.favorite ? 1 : undefined }),
        signal,
    });
}

export function listAdminOfficialAssets(params: OfficialAssetListParams, signal?: AbortSignal) {
    return http.get<OfficialAssetPage>("/admin/official-assets", {
        params: compactApiParams({ ...params, favorite: params.favorite ? 1 : undefined }),
        signal,
    });
}

export function getOfficialAsset(id: string, signal?: AbortSignal) {
    return http.get<{ asset: OfficialAsset }>(`/official-assets/${encodeURIComponent(id)}`, { signal });
}

export function setOfficialAssetFavorite(id: string, favorite: boolean) {
    const path = `/official-assets/${encodeURIComponent(id)}/favorite`;
    return favorite ? http.put<{ favorite: true }>(path) : http.delete<{ favorite: false }>(path);
}

export function materializeOfficialAsset(id: string) {
    return http.post<{ asset: Asset }>(`/official-assets/${encodeURIComponent(id)}/materialize`);
}

export function createOfficialAsset(input: SaveOfficialAssetInput) {
    return http.post<{ asset: OfficialAsset }>("/admin/official-assets", input);
}

export function updateOfficialAsset(id: string, input: SaveOfficialAssetInput) {
    return http.patch<{ asset: OfficialAsset }>(`/admin/official-assets/${encodeURIComponent(id)}`, input);
}

export function updateOfficialAssetStatus(id: string, status: OfficialAssetStatus) {
    return http.patch<{ asset: OfficialAsset }>(`/admin/official-assets/${encodeURIComponent(id)}/status`, { status });
}
