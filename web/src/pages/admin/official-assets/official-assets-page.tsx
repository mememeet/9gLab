import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, InputNumber, Modal, Select, Switch, Tag, Upload } from "antd";
import type { UploadFile } from "antd";
import { Archive, Check, ImagePlus, Pencil, Plus, RefreshCw, Search, Sparkles, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { ASSET_CATEGORY_LABELS, ASSET_CATEGORY_OPTIONS, type AssetCategory } from "@/lib/asset-category";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import {
    createOfficialAsset,
    listAdminOfficialAssets,
    updateOfficialAsset,
    updateOfficialAssetStatus,
    type OfficialAsset,
    type OfficialAssetStatus,
    type SaveOfficialAssetInput,
} from "@/services/api/official-assets";
import { cn } from "@/lib/utils";

type OfficialAssetFormValues = Omit<SaveOfficialAssetInput, "tags" | "resourceIds"> & { tags?: string[] };

const statusOptions: Array<{ value: OfficialAssetStatus | "all"; label: string }> = [
    { value: "all", label: "全部状态" },
    { value: "draft", label: "草稿" },
    { value: "published", label: "已发布" },
    { value: "retired", label: "已下架" },
];

export default function OfficialAssetsAdminPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<OfficialAssetFormValues>();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<OfficialAssetStatus | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(24);
    const [editor, setEditor] = useState<OfficialAsset | "new" | null>(null);
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [saving, setSaving] = useState(false);
    const [changingId, setChangingId] = useState("");
    const query = useQuery({
        queryKey: ["admin-official-assets", page, pageSize, keyword.trim(), status],
        queryFn: ({ signal }) => listAdminOfficialAssets({ page, pageSize, q: keyword.trim() || undefined, status: status === "all" ? undefined : status }, signal),
    });
    const items = query.data?.items || [];
    const total = query.data?.total || 0;

    useEffect(() => {
        if (!editor) return;
        if (editor === "new") {
            form.resetFields();
            form.setFieldsValue({ category: "other", status: "draft", aiGenerated: false, sortOrder: 0, source: "9G 官方", license: "可在 9G 创作工作台内使用", tags: [] });
        } else {
            form.setFieldsValue({
                title: editor.title,
                category: editor.category,
                status: editor.status,
                description: editor.description,
                prompt: editor.prompt,
                tags: editor.tags,
                source: editor.source,
                license: editor.license,
                aiGenerated: editor.aiGenerated,
                sortOrder: editor.sortOrder,
            });
        }
        setFiles([]);
    }, [editor, form]);

    const counts = useMemo(() => {
        const result = { published: 0, draft: 0, retired: 0 };
        for (const item of items) result[item.status] += 1;
        return result;
    }, [items]);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-official-assets"] });

    const save = async () => {
        let values: OfficialAssetFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        if (editor === "new" && files.length === 0) {
            message.warning("请至少上传一个图片或视频文件");
            return;
        }
        setSaving(true);
        try {
            let resourceIds: string[] | undefined;
            if (files.length > 0) {
                resourceIds = [];
                for (const item of files) {
                    const file = item.originFileObj;
                    if (!file) continue;
                    const uploaded = file.type.startsWith("image/") ? await uploadImage(file) : await uploadMediaFile(file, "video");
                    const resourceID = resourceIdFromStorageKey(uploaded.storageKey);
                    if (!resourceID) throw new Error("文件未上传到服务器，请检查网络后重试");
                    resourceIds.push(resourceID);
                }
                if (resourceIds.length === 0) throw new Error("没有可用的上传文件");
            }
            const input: SaveOfficialAssetInput = {
                title: values.title.trim(),
                category: values.category,
                status: values.status,
                description: values.description?.trim() || "",
                prompt: values.prompt?.trim() || "",
                tags: values.tags || [],
                source: values.source?.trim() || "",
                license: values.license?.trim() || "",
                aiGenerated: Boolean(values.aiGenerated),
                sortOrder: Number(values.sortOrder || 0),
                ...(resourceIds ? { resourceIds } : {}),
            };
            if (editor === "new") await createOfficialAsset(input);
            else if (editor) await updateOfficialAsset(editor.id, input);
            message.success(editor === "new" ? "官方资产已创建" : "官方资产已更新");
            setEditor(null);
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存官方资产失败");
        } finally {
            setSaving(false);
        }
    };

    const changeStatus = async (asset: OfficialAsset, next: OfficialAssetStatus) => {
        setChangingId(asset.id);
        try {
            await updateOfficialAssetStatus(asset.id, next);
            message.success(next === "published" ? "已发布到官方资产库" : next === "retired" ? "已下架" : "已转为草稿");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新状态失败");
        } finally {
            setChangingId("");
        }
    };

    return (
        <AdminPageFrame
            title="官方资产库"
            description="上传、整理和发布所有用户可复用的平台素材"
            actions={<><Button icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void refresh()}>刷新</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor("new")}>上传官方资产</Button></>}
            scroll
        >
            <div className="my-4 grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card sm:grid-cols-4">
                <Summary label="全部资产" value={total} />
                <Summary label="本页已发布" value={counts.published} />
                <Summary label="本页草稿" value={counts.draft} />
                <Summary label="本页已下架" value={counts.retired} />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-3">
                <Input className="min-w-60 flex-1" allowClear prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索名称、描述、标签或来源" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                <Select className="w-36" value={status} options={statusOptions} onChange={(value) => { setStatus(value); setPage(1); }} />
            </div>

            {query.isLoading ? <div className="grid min-h-64 place-items-center text-sm text-foreground/45">正在加载官方资产…</div> : query.isError ? <div className="grid min-h-64 place-items-center text-sm text-status-error">{query.error instanceof Error ? query.error.message : "加载失败"}</div> : items.length === 0 ? (
                <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-border/80 bg-card/40 text-center"><div><ImagePlus className="mx-auto mb-3 size-8 text-foreground/30" /><h2 className="font-medium">还没有官方资产</h2><p className="mt-1 text-sm text-foreground/48">上传后先保存为草稿，确认内容和授权信息后再发布。</p><Button className="mt-4" type="primary" icon={<UploadCloud className="size-4" />} onClick={() => setEditor("new")}>上传第一个资产</Button></div></div>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {items.map((asset) => <OfficialAssetAdminCard key={asset.id} asset={asset} changing={changingId === asset.id} onEdit={() => setEditor(asset)} onStatus={(next) => void changeStatus(asset, next)} />)}
                    </div>
                    <PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); }} />
                </>
            )}

            <Modal width={720} open={Boolean(editor)} title={editor === "new" ? "上传官方资产" : "编辑官方资产"} okText={saving ? "正在保存" : "保存"} cancelText="取消" confirmLoading={saving} closable={!saving} destroyOnHidden onCancel={() => { if (!saving) setEditor(null); }} onOk={() => void save()}>
                <Form className="mt-5" form={form} layout="vertical" requiredMark={false}>
                    <Form.Item label={editor === "new" ? "资产文件" : "替换资产文件（可选）"} extra={editor === "new" ? "支持同类型的多图或多视频，第一个文件作为封面。" : "资产被用户加入后不能替换底层文件，以保证历史项目可继续打开。"}>
                        <Upload.Dragger accept="image/*,video/*" multiple maxCount={12} fileList={files} beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)} disabled={saving}>
                            <UploadCloud className="mx-auto mb-2 size-6 text-foreground/45" /><p className="font-medium">点击或拖拽图片、视频到此处</p><p className="mt-1 text-xs text-foreground/45">单个官方资产最多 12 个展示文件</p>
                        </Upload.Dragger>
                    </Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="title" label="资产名称" rules={[{ required: true, message: "请输入资产名称" }, { max: 120 }]}><Input placeholder="例如：空镜·夜间城市街道" /></Form.Item>
                        <Form.Item name="category" label="业务分类" rules={[{ required: true }]}><Select options={ASSET_CATEGORY_OPTIONS} /></Form.Item>
                    </div>
                    <Form.Item name="description" label="简介"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="说明资产的内容、构图和适用场景" /></Form.Item>
                    <Form.Item name="prompt" label="创作提示"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder="可选：记录可复用的提示词或拍摄说明" /></Form.Item>
                    <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车，最多 24 个" /></Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="source" label="来源"><Input placeholder="9G 官方 / 合作方名称" /></Form.Item>
                        <Form.Item name="license" label="授权说明"><Input placeholder="使用范围或版权备注" /></Form.Item>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Form.Item name="status" label="发布状态" rules={[{ required: true }]}><Select options={statusOptions.slice(1)} /></Form.Item>
                        <Form.Item name="sortOrder" label="排序权重"><InputNumber className="w-full" precision={0} /></Form.Item>
                        <Form.Item name="aiGenerated" label="AI 内容标识" valuePropName="checked"><Switch checkedChildren="已标识" unCheckedChildren="未标识" /></Form.Item>
                    </div>
                </Form>
            </Modal>
        </AdminPageFrame>
    );
}

function OfficialAssetAdminCard({ asset, changing, onEdit, onStatus }: { asset: OfficialAsset; changing: boolean; onEdit: () => void; onStatus: (status: OfficialAssetStatus) => void }) {
    const media = asset.media[0];
    const nextStatus: OfficialAssetStatus = asset.status === "published" ? "retired" : "published";
    return (
        <article className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <button type="button" className="relative block aspect-[4/3] w-full overflow-hidden bg-muted" onClick={onEdit} aria-label={`编辑${asset.title}`}>
                {media?.kind === "video" ? <video className="size-full object-cover" src={media.fileUrl} muted preload="metadata" /> : media ? <img className="size-full object-cover" src={media.fileUrl} alt="" loading="lazy" /> : <ImagePlus className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-foreground/25" />}
                <span className={cn("absolute left-3 top-3 rounded-full px-2 py-1 text-[11px] font-medium backdrop-blur", asset.status === "published" ? "bg-emerald-500/90 text-white" : asset.status === "retired" ? "bg-black/65 text-white" : "bg-white/90 text-stone-700")}>{statusLabel(asset.status)}</span>
                {asset.aiGenerated ? <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-2 py-1 text-[11px] font-medium text-white"><Sparkles className="size-3" />AI</span> : null}
            </button>
            <div className="p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-medium text-foreground" title={asset.title}>{asset.title}</h2><p className="mt-1 text-xs text-foreground/45">{ASSET_CATEGORY_LABELS[asset.category]} · {asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片"} · {asset.media.length} 个文件</p></div><Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={`编辑${asset.title}`} /></div>
                {asset.tags.length ? <div className="mt-3 flex min-h-6 flex-wrap gap-1">{asset.tags.slice(0, 3).map((tag) => <Tag key={tag} className="m-0">{tag}</Tag>)}</div> : <div className="mt-3 min-h-6 text-xs text-foreground/35">暂无标签</div>}
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3"><span className="text-xs text-foreground/45">{asset.useCount} 人加入 · {asset.favoriteCount} 人收藏</span><Button size="small" loading={changing} danger={asset.status === "published"} icon={asset.status === "published" ? <Archive className="size-3.5" /> : <Check className="size-3.5" />} onClick={() => onStatus(nextStatus)}>{asset.status === "published" ? "下架" : "发布"}</Button></div>
            </div>
        </article>
    );
}

function Summary({ label, value }: { label: string; value: number }) {
    return <div className="flex items-center gap-3 px-4 py-3"><strong className="text-xl tabular-nums">{value}</strong><span className="truncate text-xs text-foreground/52">{label}</span></div>;
}

function statusLabel(status: OfficialAssetStatus) {
    return status === "published" ? "已发布" : status === "retired" ? "已下架" : "草稿";
}
