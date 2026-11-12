import { App, Button, InputNumber, Modal } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, AtSign, ChevronDown, FileText, ImagePlus, LayoutList, LoaderCircle, Maximize2, Music2, SlidersHorizontal, Video, X, PenLine } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { canonicalGenerationMetadata, nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { PROMPT_EDITOR_VIEWPORT_MARGIN, insertPromptReferenceAtSelection } from "@/lib/canvas/canvas-prompt-editor-size";
import { useCanvasPromptPreferencesStore } from "@/stores/canvas/use-canvas-prompt-preferences-store";
import { CanvasPromptFontSizeControl } from "./canvas-prompt-font-size-control";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { modelCompatibilityError, modelRequestOptions, defaultImageParamsForModel, type ModelRequirements } from "@/lib/model-selection";
import { autoMentionLibraryAssets, collectLibraryAssetsForMatching } from "@/lib/canvas/canvas-library-auto-mention";
import { getActiveUserScope } from "@/lib/user-scope";
import { loadAssetLibraryPage, loadAssetsForUse } from "@/services/user-data-sync";
import { listCharacters } from "@/services/api/projects";
import { useAssetStore } from "@/stores/use-asset-store";
import { referenceImageSizeSelection, type ImageDimensions } from "@/lib/canvas/canvas-reference-image-size";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasCameraControlPopover } from "./canvas-camera-control-popover";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea, type CanvasResourceMentionTextareaActions } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoPromptTools } from "./canvas-video-prompt-tools";
import { CanvasPresetPicker, type CanvasPromptPreset } from "./canvas-preset-picker";
import { CanvasNineGridPicker } from "./canvas-nine-grid-picker";
import { getNineGridMenuItems } from "./canvas-image-toolbar-tools";
import { CanvasChooseImageStylePicker } from "./canvas-choose-image-style-picker";
import { CanvasChooseEffectPicker } from "./canvas-choose-effect-picker";
import { CanvasChooseMotionPicker } from "./canvas-choose-motion-picker";
import { CanvasPortraitTexturePopover } from "./canvas-portrait-texture-popover";
import { CanvasPromptOptimizerDrawer } from "./canvas-prompt-optimizer-drawer";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode } from "@/types/canvas";
import {
    applyToolMention,
    removeToolMentions,
    autoMentionCanvasResourceReferences,
    buildAssetMentionReferences,
    buildToolMentionReference,
    canvasPromptAssetMentionIds,
    canvasResourceMentionToken,
    normalizeCanvasNodeMentionTokens,
    overwriteSameTypeToolMention,
    parseToolMentionTokens,
    type CanvasResourceReference,
} from "@/lib/canvas/canvas-resource-references";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { ConnectedReferenceShelf, ReferenceToolsPopover, referenceShelfHeading } from "./canvas-node-prompt-references";
import { PromptModalResizeHandle, PromptResizeHandle, clampExpandedModalSize, clampPromptHeight, estimatePromptContentHeight, promptEditorBounds } from "./canvas-node-prompt-resize";
import { audioConfigPatch, buildNodeConfig, defaultMode, modeDisplayName, promptPlaceholder, videoConfigPatch } from "./canvas-node-prompt-config";

export { buildNodeConfig } from "./canvas-node-prompt-config";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    projectId: string;
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => boolean | void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onAddReference?: (nodeId: string, reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    assetNodeBindings?: Record<string, string>;
    onLinkAssets?: (nodeId: string, expectedPrompt: string, nextPrompt: string, assetIds: string[]) => Promise<string>;
    onRemoveReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onReorderReferences?: (nodeId: string, orderedNodeIds: string[]) => void;
    onReplaceReference?: (nodeId: string, oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (nodeId: string, oldReference: CanvasResourceReference, files: File[]) => void;
    onClose?: () => void;
    onNodeMouseDown?: (event: ReactPointerEvent, nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    workspaceMode?: CanvasWorkspaceMode;
    onListGenerate?: (nodeId: string, prompt: string) => void;
    /** 第一张上游参考图的尺寸；图片尺寸未由用户选择时按它的比例显示和生成。 */
    referenceImageSize?: ImageDimensions;
};

export type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export const PROMPT_REFERENCE_SHELF_HEIGHT = 58;
// Reserve a useful writing area before content grows; references use their own shelf.
export const PROMPT_EDITOR_MIN_HEIGHT = 160;
export const PROMPT_EDITOR_EXPANDED_MIN_HEIGHT = 280;
export const PROMPT_EDITOR_LINE_HEIGHT = 26;
export const PROMPT_EDITOR_EXPANDED_LINE_HEIGHT = 26;
export const PROMPT_EDITOR_VERTICAL_PADDING = 16;
export const PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING = 16;
export const PROMPT_EDITOR_MAX_LINES = 10;
export const PROMPT_EDITOR_EXPANDED_MAX_LINES = 18;
const PROMPT_EDITOR_MODAL_WIDTH = "min(1200px, 92vw)";
const PROMPT_EDITOR_MODAL_DEFAULT_WIDTH = 1200;
const PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT = 420;
const imagePresetMenuItems = getNineGridMenuItems();

export function CanvasNodePromptPanel({
    projectId,
    node,
    isRunning,
    onPromptChange,
    onConfigChange,
    onGenerate,
    mentionReferences = [],
    onAddReference,
    assetNodeBindings = {},
    onLinkAssets,
    onRemoveReference,
    onReorderReferences,
    onReplaceReference,
    onReplaceReferenceFiles,
    onClose,
    onNodeMouseDown,
    onImageSettingsOpenChange,
    workspaceMode = "professional",
    onListGenerate,
    referenceImageSize,
}: CanvasNodePromptPanelProps) {
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const fontSize = useCanvasPromptPreferencesStore((state) => state.fontSize);
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const showPromptTemplates = !simpleMode && mode !== "image";
    node = { ...node, metadata: canonicalGenerationMetadata(node, mode) };
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = nodeGenerationPrompt(node);
    const [prompt, setPrompt] = useState(savedPrompt);
    const promptRef = useRef(savedPrompt);
    const promptEditorActionsRef = useRef<CanvasResourceMentionTextareaActions | null>(null);
    const expandedPromptEditorActionsRef = useRef<CanvasResourceMentionTextareaActions | null>(null);
    const [presetOpen, setPresetOpen] = useState(false);
    const [expandedPresetOpen, setExpandedPresetOpen] = useState(false);
    const [nineGridOpen, setNineGridOpen] = useState(false);
    const [expandedNineGridOpen, setExpandedNineGridOpen] = useState(false);
    const [styleToolOpen, setStyleToolOpen] = useState(false);
    const [expandedStyleToolOpen, setExpandedStyleToolOpen] = useState(false);
    const [effectToolOpen, setEffectToolOpen] = useState(false);
    const [expandedEffectToolOpen, setExpandedEffectToolOpen] = useState(false);
    const [motionToolOpen, setMotionToolOpen] = useState(false);
    const [expandedMotionToolOpen, setExpandedMotionToolOpen] = useState(false);
    const [expandedPromptOpen, setExpandedPromptOpen] = useState(false);
    const [expandedModalSize, setExpandedModalSize] = useState<{ width: number; height: number } | null>(null);
    const expandedModalRef = useRef<HTMLDivElement>(null);
    const [promptContentHeight, setPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, false, fontSize));
    const [expandedPromptContentHeight, setExpandedPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, true, fontSize));
    const [manualPromptHeight, setManualPromptHeight] = useState<number | null>(null);
    const [paramsExpanded, setParamsExpanded] = useState(false); // #98 决策2：B区参数区折叠状态（手风琴）
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [autoLinkEnabled, setAutoLinkEnabled] = useState(true);
    const [matchingAssets, setMatchingAssets] = useState(false);
    const resolvedMentionReferences = useResolvedCanvasResourceReferences(mentionReferences, { projectId });
    const matchingContext = JSON.stringify([projectId, node.id, Boolean(node.metadata?.locked), resolvedMentionReferences.map(({ id, title, label, active, mentionToken }) => [id, title, label, active, mentionToken])]);
    const matchingContextRef = useRef(matchingContext);
    matchingContextRef.current = matchingContext;
    const promptToolReferences = useMemo(() => parseToolMentionTokens(prompt).map(({ toolId, label, type, icon }) => buildToolMentionReference(toolId, label, type, icon)), [prompt]);
    const textareaReferences = useMemo(() => {
        const displayReferences = resolvedMentionReferences.map((reference) => (assetNodeBindings[reference.nodeId] && reference.title ? { ...reference, label: reference.title, mentionToken: canvasResourceMentionToken(reference) } : reference));
        if (!promptToolReferences.length) return displayReferences;
        const existingIds = new Set(displayReferences.map((r) => r.id));
        const extras = promptToolReferences.filter((r) => !existingIds.has(r.id));
        return extras.length ? [...displayReferences, ...extras] : displayReferences;
    }, [resolvedMentionReferences, promptToolReferences, assetNodeBindings]);
    // 当前提示词持有的九宫格工具图标，用于触发按钮回显已选工具。
    const activeNineGridTool = useMemo(() => parseToolMentionTokens(prompt).find((tool) => tool.type === "nine_grid"), [prompt]);
    const activeNineGridIcon = activeNineGridTool?.icon ?? "Grid3x3";
    const selectedPresetPlaceholder = mode === "image" ? imagePresetMenuItems.find((item) => item.toolId === activeNineGridTool?.toolId)?.placeholder : undefined;
    const activeStyleTool = parseToolMentionTokens(prompt).find((t) => t.type === "style");
    const activeEffectTool = parseToolMentionTokens(prompt).find((t) => t.type === "effect");
    // 当前提示词持有的运镜工具标签（可多个），用于运镜按钮回显与菜单高亮。
    const activeMotionTools = useMemo(() => parseToolMentionTokens(prompt).filter((tool) => tool.type === "motion"), [prompt]);
    const activeMotionTool = activeMotionTools[0];
    const normalizedSavedPrompt = useMemo(() => normalizeCanvasNodeMentionTokens(savedPrompt, mentionReferences), [mentionReferences, savedPrompt]);
    const activeReferences = resolvedMentionReferences.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const requirements: ModelRequirements = {
        capability: mode,
        input: {
            textCount: (prompt.trim() ? 1 : 0) + activeReferences.filter((item) => item.kind === "text").length,
            imageCount: activeReferences.filter((item) => item.kind === "image").length,
            videoCount: activeReferences.filter((item) => item.kind === "video").length,
            audioCount: activeReferences.filter((item) => item.kind === "audio").length,
            characterCount: activeReferences.filter((item) => item.kind === "character").length,
        },
        videoOperation: node.metadata?.videoEditOperation,
        videoSeconds: mode === "video" ? (node.metadata?.seconds ?? globalConfig.videoSeconds) : undefined,
        options: modelRequestOptions(
            {
                ...globalConfig,
                size: node.metadata?.size || globalConfig.size,
                quality: node.metadata?.quality || globalConfig.quality,
                count: String(node.metadata?.count || globalConfig.count),
                transparentBackground: node.metadata?.transparentBackground || globalConfig.transparentBackground,
                videoSeconds: node.metadata?.seconds ?? globalConfig.videoSeconds,
                vquality: node.metadata?.vquality || globalConfig.vquality,
                videoGenerateAudio: node.metadata?.generateAudio ?? globalConfig.videoGenerateAudio,
                videoWatermark: node.metadata?.watermark ?? globalConfig.videoWatermark,
                audioVoice: node.metadata?.audioVoice ?? globalConfig.audioVoice,
                audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat,
                audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed,
            },
            mode,
        ),
    };
    const config = buildNodeConfig(globalConfig, node, mode, requirements, referenceImageSize);
    const resolvedRequirements: ModelRequirements = {
        ...requirements,
        options: modelRequestOptions(config, mode),
        videoSeconds: mode === "video" ? config.videoSeconds : undefined,
    };
    const promptOptimizerProvider = useMemo(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, globalConfig));
    }, [globalConfig, promptOptimizerEnabled, promptOptimizerInstallation]);
    const generationCount = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const priceChannel = resolveModelChannel(config, config.model);
    const configuredCredits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(config.model),
        count: mode === "image" ? generationCount : 1,
        seconds: mode === "video" ? config.videoSeconds : 1,
        capability: mode,
        config,
        requirements: resolvedRequirements,
    });
    const quoteRequest = modelQuoteRequest(config, config.model, mode, resolvedRequirements);
    const quoteRequestKey = JSON.stringify(quoteRequest || null);
    const [quoteState, setRouteQuote] = useState<{ key: string; quote: LogicalModelQuote } | null>(null);
    const [quoteFailed, setQuoteFailed] = useState(false);
    const [quoteAttempt, setQuoteAttempt] = useState(0);
    const routeQuote = quoteState?.key === quoteRequestKey ? quoteState.quote : null;
    const awaitingImageQuote = creditsEnabled && mode === "image" && Boolean(quoteRequest) && !routeQuote;
    const credits = routeQuote ? routeQuote.amountMicrocredits / 1_000_000 : configuredCredits;
    const activeReferenceCount = activeReferences.length;
    const videoFrameOptions = resolvedMentionReferences.filter((item) => item.active && item.kind === "image").map((item) => ({ nodeId: item.nodeId, label: item.label, title: item.title, previewUrl: item.previewUrl }));
    const hasVideoPromptTools = mode === "video" && !simpleMode && videoFrameOptions.length > 0;
    const monochromeAccent = theme.node.activeStroke;
    const composerTokens = {
        "--canvas-composer-surface": theme.node.panel,
        "--canvas-composer-control-surface": theme.toolbar.itemHover,
        "--canvas-composer-control-hover": theme.toolbar.activeBg,
        "--canvas-composer-shadow": theme.node.shadow,
        "--cn-text": theme.node.text,
    } as CSSProperties;
    const composerSurfaceStyle = {
        ...composerTokens,
        background: theme.node.panel,
        color: theme.node.text,
        boxShadow: theme.node.shadow,
    } as CSSProperties;
    const promptBounds = promptEditorBounds(false, activeReferenceCount > 0, fontSize);
    const expandedPromptBounds = promptEditorBounds(true, activeReferenceCount > 0, fontSize);
    const composerHeight = clampPromptHeight(manualPromptHeight ?? promptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), promptBounds);
    const expandedComposerHeight = clampPromptHeight(expandedPromptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), expandedPromptBounds);
    const measureExpandedModalSize = () => {
        const rect = expandedModalRef.current?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return { width: PROMPT_EDITOR_MODAL_DEFAULT_WIDTH, height: PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT };
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const isSubmitDisabled = !isRunning && (!prompt.trim() || (awaitingImageQuote && !quoteFailed));
    const canExpandPrompt = mode === "image" || mode === "video";
    const canOptimizePrompt = Boolean(promptOptimizerProvider) && canExpandPrompt;
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);
    const autoMentionedPrompt = useMemo(() => autoMentionCanvasResourceReferences(prompt, resolvedMentionReferences), [prompt, resolvedMentionReferences]);
    const canAutoMention = autoMentionedPrompt !== prompt;

    useEffect(() => {
        promptRef.current = normalizedSavedPrompt;
        setPrompt(normalizedSavedPrompt);
    }, [node.id, normalizedSavedPrompt]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
        setExpandedModalSize(null);
        setPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, false, fontSize));
        setExpandedPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, true, fontSize));
        setManualPromptHeight(null);
    }, [node.id]);

    useEffect(() => {
        if (!expandedPromptOpen) return;
        const constrainSize = () =>
            setExpandedModalSize((size) => {
                if (!size) return size;
                const next = clampExpandedModalSize(size);
                return next.width === size.width && next.height === size.height ? size : next;
            });
        constrainSize();
        window.addEventListener("resize", constrainSize);
        return () => window.removeEventListener("resize", constrainSize);
    }, [expandedPromptOpen]);

    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        setQuoteFailed(false);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => {
                if (!controller.signal.aborted) setRouteQuote({ key: quoteRequestKey, quote });
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setRouteQuote(null);
                    setQuoteFailed(true);
                }
            });
        return () => controller.abort();
        // quoteRequestKey captures the full normalized request without retriggering on object identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, quoteRequestKey, quoteAttempt]);

    const skillReferences = useMemo(() => resolvedMentionReferences.filter((item) => item.kind === "skill"), [resolvedMentionReferences]);

    const updatePrompt = (value: string) => {
        if (node.metadata?.locked) return false;
        if (value === promptRef.current) return true;
        if (onPromptChange(node.id, value) === false) return false;
        promptRef.current = value;
        setPrompt(value);
        if (showPromptTemplates && /(^|\s)\/[\p{L}\p{N}_-]*$/u.test(value)) {
            if (expandedPromptOpen) setExpandedPresetOpen(true);
            else setPresetOpen(true);
        }
        return true;
    };

    const updatePromptFromCurrent = (updater: (currentPrompt: string) => string) => {
        updatePrompt(updater(promptRef.current));
    };

    const linkLibraryAssets = async () => {
        if (matchingAssets || node.metadata?.locked || !promptRef.current.trim()) return;
        const originalPrompt = promptRef.current;
        const context = matchingContext;
        const scope = getActiveUserScope();
        const userId = useUserStore.getState().user?.id;
        setMatchingAssets(true);
        try {
            const localAssets = useAssetStore.getState().assets;
            let assets = userId
                ? await collectLibraryAssetsForMatching(localAssets, async (page) => {
                      const result = await loadAssetLibraryPage({ page, pageSize: 100, status: "active" });
                      if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新关联素材");
                      return result;
                  })
                : localAssets;
            if (userId) {
                assets = await collectLibraryAssetsForMatching(assets, async (page) => {
                    const result = await listCharacters({ page, pageSize: 48 });
                    if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新关联素材");
                    return {
                        assets: result.characters.map(({ asset, character }) => ({
                            id: asset.id,
                            title: asset.title,
                            kind: "entity" as const,
                            category: "character" as const,
                            coverUrl: "",
                            tags: [],
                            primaryVersionId: asset.primaryVersionId,
                            data: { definition: character.definition },
                            createdAt: asset.updatedAt,
                            updatedAt: asset.updatedAt,
                        })),
                        hasMore: result.hasMore,
                    };
                });
            }
            const assetIdsInLibrary = new Set(assets.map((asset) => asset.id));
            const distinctReferences = resolvedMentionReferences.filter((reference) => !assetNodeBindings[reference.nodeId] || !assetIdsInLibrary.has(assetNodeBindings[reference.nodeId]));
            const result = autoMentionLibraryAssets(originalPrompt, assets, distinctReferences);
            const referencedAssetIds = canvasPromptAssetMentionIds(result.prompt);
            const assetsToLoad = [...referencedAssetIds, ...result.conflictAssetIds];
            if (assetsToLoad.length) await loadAssetsForUse(assetsToLoad);
            if (getActiveUserScope() !== scope || matchingContextRef.current !== context || promptRef.current !== originalPrompt) {
                message.warning("节点内容、引用或账号已变化，请重新关联素材");
                return;
            }
            if (referencedAssetIds.length) {
                if (!onLinkAssets) throw new Error("当前节点无法创建素材连线");
                const linkedPrompt = await onLinkAssets(node.id, originalPrompt, result.prompt, referencedAssetIds);
                promptRef.current = linkedPrompt;
                setPrompt(linkedPrompt);
            } else if (result.occurrences && updatePrompt(result.prompt) === false) return;
            const matchedIds = new Set(canvasPromptAssetMentionIds(result.prompt));
            const matched = buildAssetMentionReferences(assets.filter((asset) => matchedIds.has(asset.id) && !activeReferences.some((reference) => assetNodeBindings[reference.nodeId] === asset.id)));
            const allInputs = [...activeReferences, ...matched];
            const compatibility = modelCompatibilityError(config, config.model, {
                ...resolvedRequirements,
                input: {
                    textCount: 1 + allInputs.filter((item) => item.kind === "text").length,
                    imageCount: allInputs.filter((item) => item.kind === "image").length,
                    videoCount: allInputs.filter((item) => item.kind === "video").length,
                    audioCount: allInputs.filter((item) => item.kind === "audio").length,
                    characterCount: allInputs.filter((item) => item.kind === "character").length,
                },
            });
            if (result.occurrences || referencedAssetIds.length) message.success(`已关联 ${result.matchedCount || referencedAssetIds.length} 个素材${result.occurrences ? `，共 ${result.occurrences} 处` : ""}`);
            else if (!result.conflicts.length) message.info("没有发现需要新增关联的同名素材");
            if (result.conflicts.length) message.warning(`同名素材需要输入 @ 手动选择：${result.conflicts.join("、")}`, 8);
            if (result.occurrences && compatibility) message.warning(`当前模型可能无法使用全部引用：${compatibility}。请调整素材或模型。`, 8);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取素材库失败，请重试");
        } finally {
            setMatchingAssets(false);
        }
    };

    const applyPreset = (preset: CanvasPromptPreset) => {
        const withoutSlash = prompt.replace(/(^|\s)\/[\p{L}\p{N}_-]*$/u, "$1").trimEnd();
        updatePrompt(withoutSlash ? `${withoutSlash}\n${preset.prompt}` : preset.prompt);
    };

    const insertPromptReference = (reference: CanvasResourceReference) => {
        const token = canvasResourceMentionToken(reference);
        const editorActions = expandedPromptOpen ? expandedPromptEditorActionsRef.current : promptEditorActionsRef.current;
        if (editorActions) {
            editorActions.insertTextAtSelection(token);
            return;
        }
        const pendingMentionMatch = /@[^\s@，。！？、,.!?;:]*\s*$/.exec(prompt);
        const basePrompt = pendingMentionMatch ? prompt.slice(0, pendingMentionMatch.index) : prompt;
        updatePrompt(basePrompt ? `${basePrompt.replace(/\s*$/u, "")} ${token} ` : `${token} `);
    };

    const removeMotionToolMention = () => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "motion"));

    const changeModel = (model: string) => {
        if (mode !== "image") {
            onConfigChange(node.id, { model });
            return;
        }
        // 切换模型回到新模型默认参数；接了参考图时比例仍跟随参考图，空节点占位框随之改比例。
        const defaults = defaultImageParamsForModel(config, model);
        const referenceSize = referenceImageSize ? referenceImageSizeSelection(config, model, referenceImageSize, defaults) : undefined;
        onConfigChange(node.id, { model, ...defaults, ...referenceSize, imageSizeSource: referenceSize ? "reference" : "default" });
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return false;
        if (awaitingImageQuote) {
            if (quoteFailed) setQuoteAttempt((attempt) => attempt + 1);
            return false;
        }
        if (mode === "text" && node.metadata?.listMode && onListGenerate) onListGenerate(node.id, text);
        else onGenerate(node.id, mode, text);
        return true;
    };

    const submitExpandedPrompt = () => {
        if (submit()) {
            setExpandedPresetOpen(false);
            setExpandedNineGridOpen(false);
            setExpandedPromptOpen(false);
        }
    };

    const renderComposerHeader = (expanded: boolean) => (
        <div
            className="canvas-node-composer-header cursor-grab select-none active:cursor-grabbing"
            data-canvas-node-drag-handle
            title="拖动节点"
            onPointerDown={(event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target?.closest('button, input, textarea, select, a, [contenteditable="true"], [data-canvas-no-drag]')) onNodeMouseDown?.(event, node.id);
            }}
        >
            {isPortraitTexture ? (
                <>
                    <CanvasPortraitTexturePopover value={node.metadata?.portraitTexture} placement={expanded ? "topRight" : "topLeft"} onChange={(portraitTexture) => onConfigChange(node.id, { portraitTexture })} />
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                </>
            ) : (
                <div className="canvas-node-composer-mode">
                    <span className="canvas-node-composer-mode-icon" style={{ color: monochromeAccent }}>
                        <GenerationModeIcon mode={mode} />
                    </span>
                    <span className="canvas-node-composer-mode-title truncate">{modeDisplayName(mode)}生成</span>
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                </div>
            )}
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                <CanvasPromptFontSizeControl />
                {!simpleMode && (mode === "image" || mode === "video") ? (
                    <div className="canvas-node-tool-controls canvas-node-tool-controls-inline flex items-center gap-1" data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(e) => e.stopPropagation()}>
                        {mode === "image" ? (
                            <>
                                <CanvasChooseImageStylePicker
                                    open={expanded ? expandedStyleToolOpen : styleToolOpen}
                                    onOpenChange={expanded ? setExpandedStyleToolOpen : setStyleToolOpen}
                                    activeToolId={activeStyleTool?.toolId}
                                    activeLabel={activeStyleTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "style" }, "Palette"))}
                                    onClear={() => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "style"))}
                                />
                                <CanvasNineGridPicker
                                    open={expanded ? expandedNineGridOpen : nineGridOpen}
                                    onOpenChange={expanded ? setExpandedNineGridOpen : setNineGridOpen}
                                    icon={activeNineGridIcon}
                                    onSelect={(id, label, icon) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "nine_grid" }, icon))}
                                />
                            </>
                        ) : (
                            <>
                                <CanvasChooseEffectPicker
                                    open={expanded ? expandedEffectToolOpen : effectToolOpen}
                                    onOpenChange={expanded ? setExpandedEffectToolOpen : setEffectToolOpen}
                                    activeToolId={activeEffectTool?.toolId}
                                    activeLabel={activeEffectTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "effect" }, "Aperture"))}
                                    onClear={() => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "effect"))}
                                />
                                <CanvasChooseMotionPicker
                                    open={expanded ? expandedMotionToolOpen : motionToolOpen}
                                    onOpenChange={expanded ? setExpandedMotionToolOpen : setMotionToolOpen}
                                    activeToolIds={activeMotionTools.map((t) => t.toolId)}
                                    activeLabel={activeMotionTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "motion" }, "Camera"))}
                                    onClear={removeMotionToolMention}
                                />
                            </>
                        )}
                    </div>
                ) : null}
                {showPromptTemplates ? (
                    <CanvasPresetPicker mode={mode} skillReferences={skillReferences} open={expanded ? expandedPresetOpen : presetOpen} onOpenChange={expanded ? setExpandedPresetOpen : setPresetOpen} onSelect={applyPreset} dense appearance="quiet" />
                ) : null}
                {canOptimizePrompt ? (
                    <Tooltip title="用 AI 润色提示词">
                        <button type="button" className="canvas-node-composer-header-action is-labeled" onClick={() => setPromptOptimizerOpen(true)} aria-label="润色提示词">
                            <PenLine />
                            <span>润色</span>
                        </button>
                    </Tooltip>
                ) : null}
                {/* 工具类操作与窗口类操作（放大/关闭）分组，避免关闭按钮混在命令里。 */}
                {!expanded && (canExpandPrompt || onClose) && ((!simpleMode && (mode === "image" || mode === "video")) || showPromptTemplates || canOptimizePrompt) ? <span className="canvas-node-composer-header-divider" aria-hidden /> : null}
                {!expanded && canExpandPrompt ? (
                    <Tooltip title="放大编辑">
                        <button type="button" className="canvas-node-composer-header-action is-icon" onClick={() => setExpandedPromptOpen(true)} aria-label="放大编辑提示词">
                            <Maximize2 />
                        </button>
                    </Tooltip>
                ) : null}
                {!expanded && onClose ? (
                    <Tooltip title="关闭">
                        <button type="button" className="canvas-node-composer-header-action is-icon" onClick={onClose} aria-label="关闭创作面板">
                            <X />
                        </button>
                    </Tooltip>
                ) : null}
            </div>
        </div>
    );

    const renderSubmitButton = (expanded: boolean) => {
        const showCost = creditsEnabled && credits !== null && !awaitingImageQuote;
        const formattedCredits = credits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
        const actionLabel = isRunning
            ? "生成中"
            : awaitingImageQuote
              ? quoteFailed
                  ? "图片报价失败，点击重试"
                  : "等待图片报价"
              : showCost
                ? `${routeQuote?.reservationOnly ? "预留" : routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，生成`
                : "生成";
        return (
            <Button
                type="text"
                className={`canvas-node-composer-submit canvas-node-composer-submit-canvas ${showCost ? "has-cost" : ""}`}
                disabled={isRunning || isSubmitDisabled}
                style={
                    {
                        color: isSubmitDisabled ? theme.node.faint : theme.node.text,
                        "--canvas-composer-submit-action": isSubmitDisabled ? theme.toolbar.itemHover : monochromeAccent,
                        "--canvas-composer-submit-action-fg": isSubmitDisabled ? theme.node.faint : theme.canvas.background,
                    } as CSSProperties
                }
                onClick={() => (expanded ? submitExpandedPrompt() : submit())}
                aria-label={actionLabel}
                title={routeQuote ? modelQuoteDescription(routeQuote) : actionLabel}
            >
                {showCost ? (
                    <span className="canvas-node-composer-submit-cost">
                        <CreditSymbol />
                        <span>{routeQuote?.reservationOnly ? `预留:${formattedCredits}` : routeQuote?.estimated ? `预估:${formattedCredits}` : formattedCredits}</span>
                    </span>
                ) : null}
                <span className="canvas-node-composer-submit-action" aria-hidden>
                    {isRunning ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" strokeWidth={2.4} />}
                </span>
            </Button>
        );
    };

    const renderComposerControls = (expanded: boolean) =>
        simpleMode ? (
            <div className="canvas-node-composer-footer">
                <span className="min-w-0 truncate px-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                    {activeReferenceCount ? `已连接 ${activeReferenceCount} 个素材` : "将使用默认模型与参数"}
                </span>
                {(mode === "text" || mode === "video") && (
                    <button
                        type="button"
                        data-canvas-no-zoom
                        className="canvas-node-composer-settings-trigger inline-flex shrink-0 items-center gap-1"
                        disabled={matchingAssets || Boolean(node.metadata?.locked) || !prompt.trim()}
                        onClick={() => void linkLibraryAssets()}
                    >
                        <AtSign className="size-3.5" />
                        {matchingAssets ? "关联中" : "一键关联"}
                    </button>
                )}
                <ReferenceToolsPopover canAutoMention={canAutoMention} autoLinkEnabled={autoLinkEnabled} onAutoMention={() => updatePrompt(autoMentionedPrompt)} onAutoLinkEnabledChange={setAutoLinkEnabled} accent={monochromeAccent} compact />
                {renderSubmitButton(expanded)}
            </div>
        ) : (
            <div className="canvas-node-composer-footer">
                <div className={expanded ? "min-w-0 flex-1" : "canvas-node-composer-model"}>
                    <ModelPicker
                        className="canvas-node-composer-model-trigger !h-8 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                        fullWidth
                        config={config}
                        value={config.model}
                        onChange={changeModel}
                        capability={mode}
                        requirements={resolvedRequirements}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        showSelectedPrice={false}
                        showOptionPrices={creditsEnabled}
                        variant="creation"
                        showConfiguredModelName
                    />
                </div>
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                    {(mode === "text" || mode === "video") && (
                        <button
                            type="button"
                            data-canvas-no-zoom
                            className="canvas-node-composer-settings-trigger inline-flex shrink-0 items-center gap-1"
                            disabled={matchingAssets || Boolean(node.metadata?.locked) || !prompt.trim()}
                            onClick={() => void linkLibraryAssets()}
                        >
                            <AtSign className="size-3.5" />
                            {matchingAssets ? "关联中" : "一键关联"}
                        </button>
                    )}
                    <ReferenceToolsPopover
                        canAutoMention={canAutoMention}
                        autoLinkEnabled={autoLinkEnabled}
                        onAutoMention={() => updatePrompt(autoMentionedPrompt)}
                        onAutoLinkEnabledChange={setAutoLinkEnabled}
                        accent={monochromeAccent}
                        compact={!expanded}
                    />
                    {mode === "text" ? (
                        <>
                            <div className="flex h-7 items-center overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke }}>
                                <button
                                    type="button"
                                    aria-pressed={!node.metadata?.listMode}
                                    onClick={() => onConfigChange(node.id, { listMode: false })}
                                    className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${!node.metadata?.listMode ? "font-medium" : ""}`}
                                    style={!node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}
                                >
                                    <FileText className="size-3" />
                                    文本
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={Boolean(node.metadata?.listMode)}
                                    onClick={() => onConfigChange(node.id, { listMode: true })}
                                    className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${node.metadata?.listMode ? "font-medium" : ""}`}
                                    style={node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}
                                >
                                    <LayoutList className="size-3" />
                                    列表
                                </button>
                            </div>
                            {!node.metadata?.listMode ? (
                                <Tooltip title={`文本生成份数（默认 1，可在生成配置中调整）`}>
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={15}
                                        value={Math.max(1, Math.min(15, Math.floor(Math.abs(Number(node.metadata?.textCount) || 1))))}
                                        onChange={(value) =>
                                            onConfigChange(node.id, {
                                                textCount: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value) || 1)))),
                                            })
                                        }
                                        aria-label="文本生成份数"
                                        className="!w-14 !h-7 [&_.ant-input-number-input]:!text-[var(--fs-tiny)]"
                                    />
                                </Tooltip>
                            ) : (
                                <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                    行数和列结构由模型判断
                                </span>
                            )}
                        </>
                    ) : mode === "image" ? (
                        // 图片模式下，显示相机配置与镜头配置
                        <>
                            <CanvasCameraControlPopover cameraControl={node.metadata?.cameraControl} onCameraControlChange={(options) => onConfigChange(node.id, { cameraControl: options })} theme={theme} compact={!expanded} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement={expanded ? "topRight" : "topLeft"}
                                buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : key === "size" ? { size: value, imageSizeSource: "user" } : { [key]: value })}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                                onOpenChange={expanded ? undefined : onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <CanvasVideoSettingsPopover config={config} buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                    ) : mode === "audio" ? (
                        <CanvasAudioSettingsPopover config={config} buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                    ) : null}
                    {renderSubmitButton(expanded)}
                </div>
            </div>
        );

    const renderPromptEditor = (expanded: boolean, fill = false) => {
        const bounds = expanded ? expandedPromptBounds : promptBounds;
        const height = expanded ? expandedComposerHeight : composerHeight;
        return (
            <>
                <div className={fill ? "canvas-node-composer-editor flex-1" : "canvas-node-composer-editor"} style={fill ? { minHeight: bounds.min } : { height, ...(expanded ? { flexShrink: 0 } : null) }}>
                    <ConnectedReferenceShelf
                        targetNodeId={node.id}
                        references={resolvedMentionReferences}
                        theme={theme}
                        onInsert={insertPromptReference}
                        onRemove={(reference) => onRemoveReference?.(node.id, reference)}
                        onReorder={onReorderReferences ? (orderedNodeIds) => onReorderReferences(node.id, orderedNodeIds) : undefined}
                        onReplaceReference={onReplaceReference ? (oldReference, sourceNodeId) => onReplaceReference(node.id, oldReference, sourceNodeId) : undefined}
                        onReplaceReferenceFiles={onReplaceReferenceFiles ? (oldReference, files) => onReplaceReferenceFiles(node.id, oldReference, files) : undefined}
                    />
                    <CanvasResourceMentionTextarea
                        value={prompt}
                        readOnly={Boolean(node.metadata?.locked)}
                        references={textareaReferences}
                        onSelectReference={onAddReference ? (reference) => onAddReference(node.id, reference) : undefined}
                        includeAssetLibrary
                        onChange={updatePrompt}
                        autoLinkEnabled={autoLinkEnabled}
                        onReferenceFilesDrop={onReplaceReferenceFiles ? (reference, files) => onReplaceReferenceFiles(node.id, reference, files) : undefined}
                        onContentSizeChange={expanded ? setExpandedPromptContentHeight : setPromptContentHeight}
                        actionsRef={expanded ? expandedPromptEditorActionsRef : promptEditorActionsRef}
                        containerClassName="min-h-0 flex-1"
                        className={
                            expanded
                                ? "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-2 text-[var(--fs-body-lg)] leading-6 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                                : "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-2 py-2 text-[var(--fs-body)] leading-5 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                        }
                        style={{ color: theme.node.text, outline: "none", boxShadow: "none", fontSize, lineHeight: 1.6 }}
                        placeholder={selectedPresetPlaceholder || promptPlaceholder(mode, hasImageContent, hasTextContent)}
                        aria-label={`${modeDisplayName(mode)}提示词`}
                    />
                </div>
                {!expanded && <PromptResizeHandle height={height} min={bounds.min} max={bounds.max} onResize={setManualPromptHeight} />}
            </>
        );
    };

    return (
        <CanvasPromptOptimizerDrawer
            open={promptOptimizerOpen}
            prompt={prompt}
            generationMode={mode === "image" || mode === "video" ? mode : "image"}
            targetModel={modelOptionName(config.model) || config.model}
            targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(config.model))?.protocol || priceChannel.interfaceType}
            config={globalConfig}
            optimizerModel={globalConfig.textModel}
            references={activeReferences}
            provider={promptOptimizerProvider}
            onClose={() => setPromptOptimizerOpen(false)}
            onApply={(nextPrompt) => updatePrompt(nextPrompt)}
        >
            <div className="canvas-node-composer" style={composerSurfaceStyle} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                {renderComposerHeader(false)}

                {renderPromptEditor(false)}

                {/* B区 参数区（对应 #98 决策2：默认折叠，手风琴展开）*/}
                {hasVideoPromptTools ? (
                    <div className="canvas-node-composer-parameters overflow-hidden">
                        <button
                            type="button"
                            className="canvas-node-composer-parameters-toggle flex w-full items-center gap-2 rounded-[var(--r-md)] px-2 py-1 text-[var(--fs-micro)] font-medium transition-colors"
                            style={{ color: theme.node.muted }}
                            onClick={() => setParamsExpanded(!paramsExpanded)}
                            aria-expanded={paramsExpanded}
                            aria-label={paramsExpanded ? "收起参数" : "展开参数"}
                        >
                            <SlidersHorizontal className="size-3" strokeWidth={1.8} />
                            <span className="flex-1 text-left">参数</span>
                            <ChevronDown className={`size-3 transition-transform duration-200 ${paramsExpanded ? "rotate-180" : ""}`} strokeWidth={1.8} />
                        </button>
                        {paramsExpanded ? (
                            <div className="pt-1">
                                <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {renderComposerControls(false)}

                <Modal
                    className="canvas-prompt-editor-modal"
                    open={expandedPromptOpen}
                    title={null}
                    footer={null}
                    centered
                    width={expandedModalSize ? expandedModalSize.width : PROMPT_EDITOR_MODAL_WIDTH}
                    style={{ maxWidth: `calc(100vw - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)` }}
                    destroyOnHidden
                    onCancel={() => {
                        setExpandedPresetOpen(false);
                        setExpandedNineGridOpen(false);
                        setExpandedPromptOpen(false);
                    }}
                    styles={{
                        container: { border: 0, borderRadius: "var(--canvas-composer-radius)", padding: 0, overflow: "hidden", background: theme.node.panel, boxShadow: theme.node.shadow },
                        body: { minHeight: 0, padding: 0 },
                    }}
                >
                    <div
                        ref={expandedModalRef}
                        className="relative flex min-h-0 flex-col"
                        style={{ ...composerTokens, color: theme.node.text, maxHeight: `calc(100dvh - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)`, ...(expandedModalSize ? { height: expandedModalSize.height } : null) }}
                    >
                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                            <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                            {renderPromptEditor(true, Boolean(expandedModalSize))}
                            {hasVideoPromptTools ? (
                                <div className="canvas-node-composer-parameters shrink-0">
                                    <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                                </div>
                            ) : null}
                            <div className="shrink-0">{renderComposerControls(true)}</div>
                        </div>
                        <PromptModalResizeHandle size={expandedModalSize} measure={measureExpandedModalSize} onResize={setExpandedModalSize} accent={theme.node.muted} />
                    </div>
                </Modal>
            </div>
        </CanvasPromptOptimizerDrawer>
    );
}

function GenerationModeIcon({ mode }: { mode: CanvasNodeGenerationMode }) {
    if (mode === "image") return <ImagePlus className="size-3" />;
    if (mode === "video") return <Video className="size-3" />;
    if (mode === "audio") return <Music2 className="size-3" />;
    return <FileText className="size-3" />;
}
