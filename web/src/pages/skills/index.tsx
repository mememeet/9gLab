import { App, Button, Dropdown, Input, Select } from "antd";

import { Boxes, Check, Clapperboard, Heart, Megaphone, MoreHorizontal, Palette, Plus, Puzzle, Search, ShoppingBag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories, formatSkillCount, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { addSkill, deleteSkill, getSkill, likeSkill, listSkills, removeSkill, syncSkill, unlikeSkill, type Skill, type SkillCategory, type SkillScope, type SkillSort } from "@/services/api/skills";

const scopeOptions = [
    { label: "Skill", value: "public" },
    { label: "我的 Skill", value: "mine" },
    { label: "我创建的", value: "created" },
    { label: "我的收藏", value: "favorites" },
];

/* 分类图标映射：画廊卡片顶部的图标块，未知分类回退 Boxes。 */
const categoryIcons: Record<string, LucideIcon> = {
    drama: Clapperboard,
    ecommerce: ShoppingBag,
    creative: Palette,
    social: Megaphone,
    others: Puzzle,
};
const categoryIconOf = (value: string) => categoryIcons[value] ?? Boxes;

const sortOptions: { label: string; value: SkillSort }[] = [
    { label: "最多加入", value: "popular" },
    { label: "最新发布", value: "new" },
    { label: "最近更新", value: "updated" },
];

export default function SkillsPage() {
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<SkillScope>("public");
    const [sort, setSort] = useState<SkillSort>("popular");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [tag, setTag] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState<Partial<Record<SkillScope, number>>>({});
    const tabsRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        listSkills({ page, pageSize, scope, sort, search: debouncedSearch || undefined, tag: tag === "all" ? undefined : tag })
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.totalCount);
                setCounts((prev) => ({ ...prev, [scope]: result.totalCount }));
                if (result.categories.length) setCategories(result.categories);
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setTotal(0);
                setLoadError(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, page, pageSize, reloadKey, scope, sort, tag]);

    const filtersActive = Boolean(search || tag !== "all" || sort !== "popular");
    const resetFilters = useCallback(() => { setSearch(""); setTag("all"); setSort("popular"); setPage(1); }, []);
    const sectionTitle = scope === "public" ? "官方精选" : scope === "mine" ? "我的 Skill" : scope === "created" ? "我创建的" : "我的收藏";

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skillId);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能详情加载失败");
            setActiveSkill(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const openEditor = async (skill?: Skill) => {
        if (!skill) {
            setEditingSkill(null);
            setEditorOpen(true);
            return;
        }
        try {
            const result = skill.instruction ? { skill } : await getSkill(skill.skillId);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能读取失败");
        }
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => item.skillId === next.skillId ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setActiveSkill((current) => current?.skillId === next.skillId ? { ...current, ...next, instruction: next.instruction || current.instruction } : current);
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.isOwner) return;
        setMutatingID(skill.skillId);
        try {
            const result = skill.isAdded ? await removeSkill(skill.skillId) : await addSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isAdded ? "已加入我的技能" : "已从我的技能移除");
            if (scope === "mine" && !result.skill.isAdded) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = skill.isLike ? await unlikeSkill(skill.skillId) : await likeSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isLike ? "已收藏" : "已取消收藏");
            if (scope === "favorites" && !result.skill.isLike) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const synchronizeSkill = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = await syncSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.versionId === skill.versionId ? "已是最新版本" : "已同步最新版本");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "GitHub 技能同步失败");
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: `删除“${skill.skillName}”？`,
            content: "删除后，其他用户将无法继续使用该技能，已有加入和收藏关系也会一并移除。",
            okText: "删除技能",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkill(skill.skillId);
                    setActiveSkill(null);
                    message.success("技能已删除");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "技能删除失败");
                    throw error;
                }
            },
        });
    };

    return (
        <>
            <WorkspacePage className="library-page skills-library-page" grid>
                <header className="skills-design-header">
                    <div className="skills-scope-tabs" ref={tabsRef} role="tablist" aria-label="技能库范围" onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const current = scopeOptions.findIndex((option) => option.value === scope);
                        const next = event.key === "Home" ? 0 : event.key === "End" ? scopeOptions.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + scopeOptions.length) % scopeOptions.length;
                        setScope(scopeOptions[next].value as SkillScope);
                        setPage(1);
                        tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                    }}>
                        {scopeOptions.map((option) => {
                            const active = scope === option.value;
                            const count = counts[option.value as SkillScope];
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="tab"
                                    tabIndex={active ? 0 : -1}
                                    aria-selected={active}
                                    className={`skills-scope-tab${active ? " is-active" : ""}`}
                                    onClick={() => { setScope(option.value as SkillScope); setPage(1); }}
                                >
                                    <span>{option.label}</span>
                                    {count !== undefined ? <span className="skills-scope-count">{count}</span> : null}
                                </button>
                            );
                        })}
                    </div>
                    <div className="skills-design-actions">
                        <Input prefix={<Search className="size-4" />} value={search} allowClear placeholder="搜索 Skill..." aria-label="搜索技能或作者" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                        <Button onClick={() => setInstallOpen(true)}>导入 Skill</Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openEditor()}>创建 Skill</Button>
                    </div>
                </header>

                <div className="skills-category-row">
                    <div className="skills-category-chips" role="group" aria-label="技能分类">
                        {[{ value: "all", label: "全部" }, ...categories].map((category) => <button key={category.value} type="button" aria-pressed={tag === category.value} onClick={() => { setTag(category.value); setPage(1); }}>{category.label}</button>)}
                    </div>
                    <div className="skills-category-actions">
                        {filtersActive ? <Button type="text" onClick={resetFilters}>重置筛选</Button> : null}
                        <Select aria-label="技能排序" value={sort} options={sortOptions} onChange={(value) => { setSort(value); setPage(1); }} />
                    </div>
                </div>

                {loading && !skills.length ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : skills.length ? (
                    <section key={`${scope}-${page}`} className="skills-gallery" aria-labelledby="skills-gallery-title">
                        <div className="skills-gallery-heading">
                            <h2 id="skills-gallery-title">{sectionTitle}</h2>
                            <span>{total} 个</span>
                        </div>
                        <div className="skill-library-grid">
                            {skills.map((skill, index) => <SkillCard key={skill.skillId} skill={skill} categories={categories} loading={mutatingID === skill.skillId} style={{ animationDelay: `${Math.min(index, 7) * 30}ms` }} onOpen={() => void openSkill(skill)} onAdd={() => void toggleAdded(skill)} onLike={() => void toggleLiked(skill)} onEdit={() => void openEditor(skill)} onDelete={() => confirmDelete(skill)} />)}
                        </div>
                    </section>
                ) : (
                    <WorkspaceState
                        compact
                        className="min-h-[188px]"
                        icon="skills"
                        title={filtersActive ? "没有找到匹配技能" : scope === "created" ? "还没有创建技能" : scope === "public" ? "技能广场还是空的" : "这里还没有技能"}
                        description={filtersActive ? "换个关键词或分类试试。" : scope === "favorites" ? "收藏的公开技能会显示在这里。" : scope === "mine" ? "从技能广场加入后会显示在这里。" : "创建并公开第一个技能，其他用户就能直接加入使用。"}
                        action={filtersActive
                            ? <Button onClick={() => { setSearch(""); setTag("all"); setSort("popular"); setPage(1); }}>清除筛选</Button>
                            : (scope === "created" || scope === "public")
                              ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>
                              : undefined}
                    />
                )}

                <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
            </WorkspacePage>

            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skillId)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} onSync={(skill) => void synchronizeSkill(skill)} />
            <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={(skill) => { setInstallOpen(false); setActiveSkill(skill); reload(); }} onManualCreate={() => { setInstallOpen(false); void openEditor(); }} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}

function SkillCard({ skill, categories, loading, style, onOpen, onAdd, onLike, onEdit, onDelete }: { skill: Skill; categories: SkillCategory[]; loading: boolean; style?: CSSProperties; onOpen: () => void; onAdd: () => void; onLike: () => void; onEdit: () => void; onDelete: () => void }) {
    const CategoryIcon = categoryIconOf(skill.tag);
    const media = skill.showcaseMedia?.[0];
    const mediaUrl = media?.showcaseUrl || media?.showcaseUri;
    return (
        <article style={style} className={`skill-library-card${skill.isAdded ? " is-added" : ""}`}>
            <button type="button" className="skill-card-media" onClick={onOpen} aria-label={`查看 ${skill.skillName}`}>
                {mediaUrl ? (media?.type === "video" ? <video src={mediaUrl} muted playsInline preload="metadata" /> : <img src={mediaUrl} alt="" loading="lazy" />) : <span className="skill-card-media-fallback" aria-hidden="true"><CategoryIcon /></span>}
                <span className="skill-card-category">{skillCategoryLabel(skill.tag, categories)}</span>
                {skill.isPrivate ? <span className="skill-card-private">仅自己</span> : null}
            </button>
            <div className="skill-card-body">
                <div className="skill-card-title-row">
                    <button type="button" className="skill-card-title-button" onClick={onOpen}><h3>{skill.skillName}</h3></button>
                {skill.isOwner ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "edit", label: "编辑技能" },
                                { key: "delete", label: "删除技能", danger: true },
                            ],
                            onClick: ({ key }) => key === "edit" ? onEdit() : onDelete(),
                        }}
                    >
                        <button type="button" aria-label="技能操作" className="skill-card-more">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
                </div>
                <button type="button" className="skill-card-description" onClick={onOpen}><p>{skill.description || "暂无技能简介"}</p></button>
                <div className="skill-card-footer">
                    <span className="skill-card-author">@{skill.effectiveUser.name || "未知用户"}</span>
                    <button type="button" disabled={loading} className="skill-card-like" aria-label={skill.isLike ? "取消收藏" : "收藏"} onClick={onLike}>
                        <Heart className={`size-3.5 ${skill.isLike ? "fill-current text-rose-500" : ""}`} />
                        <span>{formatSkillCount(skill.likeCount)}</span>
                    </button>
                    <span className="skill-card-added-count">{formatSkillCount(skill.addedCount)} 加入</span>
                </div>
                {skill.isOwner
                    ? <div className="skill-card-action"><span className="skill-card-owner-flag">我创建的</span></div>
                    : <div className="skill-card-action"><Button loading={loading} aria-pressed={skill.isAdded} icon={skill.isAdded ? <Check /> : <Plus />} onClick={onAdd}>{skill.isAdded ? "已加入" : "加入技能库"}</Button></div>}
            </div>
        </article>
    );
}

function SkillSkeleton() {
    return <div className="library-grid skill-library-grid py-6">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[260px] animate-pulse rounded-[var(--r-xl)] bg-foreground/[.035]" />)}</div>;
}
