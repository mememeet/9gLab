import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Modal, Select, Tag } from "antd";
import { Check, Heart, LayoutGrid, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { ASSET_CATEGORY_LABELS, ASSET_CATEGORY_OPTIONS, type AssetCategory } from "@/lib/asset-category";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatBytes } from "@/lib/image-utils";
import { listOfficialAssets, materializeOfficialAsset, setOfficialAssetFavorite, type OfficialAsset } from "@/services/api/official-assets";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { AssetLibraryTabs, type AssetLibraryScope } from "./asset-library-tabs";
import "./official-assets.css";

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export function OfficialAssetsView({ onScopeChange }: { onScopeChange: (value: AssetLibraryScope) => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState("all");
    const [category, setCategory] = useState<AssetCategory | "all">("all");
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [gridDensity, setGridDensity] = useState<4 | 5>(4);
    const [sortOrder, setSortOrder] = useState<"recent" | "name">("recent");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(36);
    const [preview, setPreview] = useState<OfficialAsset | null>(null);
    const [workingId, setWorkingId] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const query = useQuery({
        queryKey: ["official-assets", page, pageSize, debouncedKeyword, kind, category, favoritesOnly],
        queryFn: ({ signal }) => listOfficialAssets({ page, pageSize, q: debouncedKeyword || undefined, kind: kind === "all" ? undefined : kind, category: category === "all" ? undefined : category, favorite: favoritesOnly }, signal),
    });
    const items = query.data?.items || [];
    const visibleItems = useMemo(() => sortOrder === "name" ? [...items].sort((left, right) => left.title.localeCompare(right.title, "zh-CN")) : items, [items, sortOrder]);
    const total = query.data?.total || 0;
    const activeFilters = Boolean(keyword || kind !== "all" || category !== "all" || favoritesOnly);

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["official-assets"] });
    };

    const toggleFavorite = async (asset: OfficialAsset) => {
        setWorkingId(asset.id);
        try {
            await setOfficialAssetFavorite(asset.id, !asset.favorite);
            if (preview?.id === asset.id) setPreview({ ...preview, favorite: !asset.favorite, favoriteCount: Math.max(0, preview.favoriteCount + (asset.favorite ? -1 : 1)) });
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏操作失败");
        } finally {
            setWorkingId("");
        }
    };

    const addToLibrary = async (asset: OfficialAsset) => {
        if (asset.materialized) return;
        setWorkingId(asset.id);
        try {
            const result = await materializeOfficialAsset(asset.id);
            const current = useAssetStore.getState().assets;
            useAssetStore.getState().replaceAssets([result.asset, ...current.filter((item) => item.id !== result.asset.id)]);
            await flushAssetStorePersistence();
            await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["asset-library"] })]);
            if (preview?.id === asset.id) setPreview({ ...preview, materialized: true });
            message.success("已加入我的资产，可在画布素材库中使用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加入资产库失败");
        } finally {
            setWorkingId("");
        }
    };

    return (
        <WorkspacePage grid className="library-page official-assets-page canvas-library-page asset-library-unified">
            <div className="studio-band asset-library-band">
                <div className="asset-library-topline">
                    <AssetLibraryTabs value="official" onChange={onScopeChange} />
                    <Input
                        allowClear
                        className="asset-library-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索名称、标签或来源"
                        onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
                    />
                    <div className="asset-library-header-actions">
                        <button type="button" aria-pressed={favoritesOnly} className={cn("asset-library-quiet-action", favoritesOnly && "is-active")} onClick={() => { setFavoritesOnly((value) => !value); setPage(1); }}>
                            <Heart aria-hidden="true" />我的收藏
                        </button>
                    </div>
                </div>
                <div className="asset-library-hero">
                    <div>
                        <div className="asset-library-title-line"><h1>资产库</h1><span>{total} 个</span></div>
                        <p>平台精选的通用创作素材，加入后可在任意画布中复用。</p>
                    </div>
                </div>
                <div className="asset-library-filters" aria-label="官方资产筛选">
                    <div className="asset-library-filter-row">
                        <div className="asset-library-filter-group">
                            <span className="asset-library-filter-label">类型</span>
                            <div className="asset-library-filter-options" aria-label="媒体类型">
                                {kindOptions.map((option) => <button key={option.value} type="button" aria-pressed={kind === option.value} className={cn("asset-library-filter-button", kind === option.value && "is-active")} onClick={() => { setKind(option.value); setPage(1); }}>{option.label}</button>)}
                            </div>
                        </div>
                    </div>
                    <div className="asset-library-filter-row">
                        <div className="asset-library-filter-group">
                            <span className="asset-library-filter-label">分类</span>
                            <div className="asset-library-filter-options" aria-label="资产分类">
                                <button type="button" aria-pressed={category === "all"} className={cn("asset-library-filter-button", category === "all" && "is-active")} onClick={() => { setCategory("all"); setPage(1); }}>全部</button>
                                {ASSET_CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={category === option.value} className={cn("asset-library-filter-button", category === option.value && "is-active")} onClick={() => { setCategory(option.value); setPage(1); }}>{option.label}</button>)}
                            </div>
                        </div>
                        <div className="asset-library-filter-actions">
                            {activeFilters ? <button type="button" className="asset-library-reset" onClick={() => { setKeyword(""); setKind("all"); setCategory("all"); setFavoritesOnly(false); setPage(1); }}>清除筛选</button> : null}
                            <Select aria-label="卡片密度" value={gridDensity} suffixIcon={<LayoutGrid className="size-3.5" />} options={[{ label: "舒适", value: 4 }, { label: "紧凑", value: 5 }]} onChange={(value) => setGridDensity(value as 4 | 5)} />
                        </div>
                    </div>
                </div>
            </div>

            <section className="collection-content official-assets-content">
                {query.isLoading ? <WorkspaceState icon="assets" compact title="正在加载官方资产" description="请稍候。" /> : query.isError ? <WorkspaceState icon="assets" compact title="官方资产加载失败" description={query.error instanceof Error ? query.error.message : "请稍后重试。"} /> : items.length === 0 ? (
                    <WorkspaceState icon="assets" compact title={activeFilters ? "没有匹配的官方资产" : "官方资产库正在准备中"} description={activeFilters ? "调整搜索或分类后再试。" : "管理员发布资产后会显示在这里。"} />
                ) : (
                    <>
                        <div className="asset-library-result-line">
                            <span>已精选 {total} 个可用资产</span>
                            <Select aria-label="资产排序" value={sortOrder} variant="borderless" options={[{ label: "最近更新", value: "recent" }, { label: "名称排序", value: "name" }]} onChange={(value) => setSortOrder(value as "recent" | "name")} />
                        </div>
                        <div className="official-assets-grid asset-library-unified-grid" style={{ "--asset-library-columns": gridDensity } as React.CSSProperties}>
                            {visibleItems.map((asset) => <OfficialAssetCard key={asset.id} asset={asset} working={workingId === asset.id} onOpen={() => setPreview(asset)} onFavorite={() => void toggleFavorite(asset)} onAdd={() => void addToLibrary(asset)} />)}
                        </div>
                        <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[24, 36, 60]} onChange={(nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); }} />
                    </>
                )}
            </section>

            <OfficialAssetDetailModal asset={preview} working={Boolean(preview && workingId === preview.id)} onClose={() => setPreview(null)} onFavorite={(asset) => void toggleFavorite(asset)} onAdd={(asset) => void addToLibrary(asset)} />
        </WorkspacePage>
    );
}

function OfficialAssetCard({ asset, working, onOpen, onFavorite, onAdd }: { asset: OfficialAsset; working: boolean; onOpen: () => void; onFavorite: () => void; onAdd: () => void }) {
    const media = asset.media[0];
    return (
        <article className="official-asset-card asset-library-unified-card">
            <button type="button" className="official-asset-card-preview asset-library-unified-media" onClick={onOpen} aria-label={`查看官方资产：${asset.title}`}>
                <OfficialAssetMedia asset={asset} />
                {asset.aiGenerated ? <span className="official-asset-ai-label"><Sparkles aria-hidden="true" />AI</span> : null}
            </button>
            <div className="official-asset-card-body asset-library-unified-copy">
                <div className="official-asset-card-title-row">
                    <button type="button" className="official-asset-card-title" onClick={onOpen}>{asset.title}</button>
                    <button type="button" className={cn("official-asset-heart", asset.favorite && "is-active")} aria-label={asset.favorite ? "取消收藏" : "收藏资产"} onClick={onFavorite} disabled={working}><Heart aria-hidden="true" fill={asset.favorite ? "currentColor" : "none"} /></button>
                </div>
                <div className="official-asset-card-meta"><span>{ASSET_CATEGORY_LABELS[asset.category]}</span><span>{media ? mediaMeta(media) : "暂无媒体"}</span></div>
                <div className="official-asset-card-footer"><span>{asset.source || "9G 官方"}</span><Button size="small" type={asset.materialized ? "default" : "primary"} icon={asset.materialized ? <Check /> : undefined} disabled={asset.materialized} loading={working} onClick={onAdd}>{asset.materialized ? "已加入" : "加入我的资产"}</Button></div>
            </div>
        </article>
    );
}

function OfficialAssetMedia({ asset, activeIndex = 0 }: { asset: OfficialAsset; activeIndex?: number }) {
    const media = asset.media[activeIndex] || asset.media[0];
    if (!media) return <div className="official-asset-media-empty">暂无预览</div>;
    if (media.kind === "video" || media.mimeType.startsWith("video/")) return <video src={media.fileUrl} muted playsInline preload="metadata" />;
    if (media.kind === "audio" || media.mimeType.startsWith("audio/")) return <div className="official-asset-media-empty">音频资产</div>;
    return <img src={media.fileUrl} alt={asset.title} loading="lazy" />;
}

function OfficialAssetDetailModal({ asset, working, onClose, onFavorite, onAdd }: { asset: OfficialAsset | null; working: boolean; onClose: () => void; onFavorite: (asset: OfficialAsset) => void; onAdd: (asset: OfficialAsset) => void }) {
    const [activeIndex, setActiveIndex] = useState(0);
    const media = asset?.media[activeIndex] || asset?.media[0];
    const tags = useMemo(() => asset?.tags || [], [asset]);
    return (
        <Modal className="workspace-modal asset-library-detail-modal official-asset-detail-modal" width={1040} open={Boolean(asset)} title={null} footer={null} onCancel={onClose} destroyOnHidden afterOpenChange={(open) => { if (!open) setActiveIndex(0); }}>
            {asset ? <div className="official-asset-detail">
                <div className="official-asset-detail-gallery">
                    <div className="official-asset-detail-stage"><OfficialAssetMedia asset={asset} activeIndex={activeIndex} /></div>
                    {asset.media.length > 1 ? <div className="official-asset-thumbnails">{asset.media.map((item, index) => <button key={item.id} type="button" aria-pressed={index === activeIndex} onClick={() => setActiveIndex(index)}><OfficialAssetMedia asset={asset} activeIndex={index} /></button>)}</div> : null}
                </div>
                <div className="official-asset-detail-copy">
                    <div className="official-asset-detail-eyebrow">官方资产 · {ASSET_CATEGORY_LABELS[asset.category]}</div>
                    <h2>{asset.title}</h2>
                    {tags.length ? <div className="official-asset-tags">{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div> : null}
                    {asset.description ? <p>{asset.description}</p> : null}
                    {asset.prompt ? <section><h3>创作提示</h3><p>{asset.prompt}</p></section> : null}
                    <dl className="official-asset-facts">
                        <div><dt>来源</dt><dd>{asset.source || "9G 官方"}</dd></div>
                        <div><dt>许可说明</dt><dd>{asset.license || "以平台使用规则为准"}</dd></div>
                        <div><dt>文件参数</dt><dd>{media ? `${media.width || "--"} × ${media.height || "--"} · ${formatBytes(media.size)}` : "--"}</dd></div>
                        <div><dt>内容标识</dt><dd>{asset.aiGenerated ? "包含 AI 生成内容" : "未标记为 AI 生成"}</dd></div>
                    </dl>
                    <div className="official-asset-detail-actions">
                        <Button type="primary" size="large" disabled={asset.materialized} loading={working} icon={asset.materialized ? <Check /> : undefined} onClick={() => onAdd(asset)}>{asset.materialized ? "已加入我的资产" : "加入我的资产"}</Button>
                        <Button size="large" icon={<Heart fill={asset.favorite ? "currentColor" : "none"} />} onClick={() => onFavorite(asset)}>{asset.favorite ? "已收藏" : "收藏"}</Button>
                    </div>
                </div>
            </div> : null}
        </Modal>
    );
}

function mediaMeta(media: OfficialAsset["media"][number]) {
    if (media.width > 0 && media.height > 0) return `${media.width} × ${media.height}`;
    if (media.durationMs > 0) return `${Math.round(media.durationMs / 1000)} 秒`;
    return media.mimeType || media.kind;
}
