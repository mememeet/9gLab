import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { CircleHelp, X } from "lucide-react";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import {
    advanceWorkspaceOnboarding,
    applyWorkspaceOnboardingAction,
    isNewWorkspaceUser,
    LEGACY_WORKSPACE_ONBOARDING_KEY,
    newWorkspaceOnboarding,
    parseWorkspaceOnboarding,
    WORKSPACE_ONBOARDING_KEY,
    WORKSPACE_ONBOARDING_STEPS,
    workspaceOnboardingPage,
    type WorkspaceOnboardingProgress,
} from "@/lib/workspace-onboarding";
import { discardWorkspaceOnboardingActions, readWorkspaceOnboardingActions, setWorkspaceOnboardingActive, WORKSPACE_ONBOARDING_EVENT } from "@/lib/workspace-onboarding-events";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkspaceOnboardingAnchor } from "./use-workspace-onboarding-anchor";
import "./workspace-onboarding.css";

export function WorkspaceOnboarding() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const supportSession = useUserStore((state) => state.supportSession);
    const agentOpen = useGlobalAgentStore((state) => state.open);
    const [progress, setProgress] = useState<WorkspaceOnboardingProgress | null>(null);
    const [ready, setReady] = useState(false);
    const [loadedScope, setLoadedScope] = useState("");
    const [busy, setBusy] = useState(false);
    const [draftReady, setDraftReady] = useState(false);
    const [eventRevision, setEventRevision] = useState(0);
    const generation = useRef(0);
    const writing = useRef(false);
    const cardRef = useRef<HTMLElement>(null);
    const scope = user?.id?.trim() || "";
    const createdAt = user?.createdAt;
    const page = workspaceOnboardingPage(pathname);
    const guideActive = Boolean(ready && loadedScope === scope && page && !supportSession && progress?.status === "active");
    const placement = useWorkspaceOnboardingAnchor(page, progress?.step ?? 0, agentOpen, draftReady, guideActive, cardRef);

    useEffect(() => {
        const current = ++generation.current;
        writing.current = false;
        setProgress(null);
        setReady(false);
        setLoadedScope("");
        setBusy(false);
        if (!scope || supportSession) return;
        const storage = localForageStorageForScope(scope);
        void Promise.all([storage.getItem(WORKSPACE_ONBOARDING_KEY), storage.getItem(LEGACY_WORKSPACE_ONBOARDING_KEY)])
            .then(async ([raw, legacy]) => {
                const loaded = parseWorkspaceOnboarding(raw) ?? parseWorkspaceOnboarding(legacy) ?? (isNewWorkspaceUser(createdAt) ? newWorkspaceOnboarding() : null);
                if (!raw) {
                    discardWorkspaceOnboardingActions(
                        scope,
                        readWorkspaceOnboardingActions(scope).map((event) => event.id),
                    );
                    if (loaded) await storage.setItem(WORKSPACE_ONBOARDING_KEY, JSON.stringify(loaded));
                }
                if (generation.current !== current) return;
                setProgress(loaded);
                setLoadedScope(scope);
                setReady(true);
            })
            .catch(() => {
                if (generation.current === current) setReady(false);
            });
        return () => {
            generation.current += 1;
        };
    }, [scope, createdAt, supportSession]);

    const save = useCallback(
        (next: WorkspaceOnboardingProgress, consumed: string[] = []) => {
            if (!scope || supportSession || writing.current) return;
            const current = generation.current;
            writing.current = true;
            setBusy(true);
            void Promise.resolve(localForageStorageForScope(scope).setItem(WORKSPACE_ONBOARDING_KEY, JSON.stringify(next)))
                .then(() => {
                    if (consumed.length) discardWorkspaceOnboardingActions(scope, consumed);
                    if (generation.current === current) setProgress(next);
                })
                .finally(() => {
                    if (generation.current === current) {
                        writing.current = false;
                        setBusy(false);
                    }
                })
                .catch(() => {});
        },
        [scope, supportSession],
    );

    useEffect(() => {
        const onAction = () => setEventRevision((value) => value + 1);
        window.addEventListener(WORKSPACE_ONBOARDING_EVENT, onAction);
        return () => window.removeEventListener(WORKSPACE_ONBOARDING_EVENT, onAction);
    }, []);

    useEffect(() => {
        if (ready && loadedScope === scope && scope) setWorkspaceOnboardingActive(scope, !supportSession && progress?.status === "active");
    }, [ready, loadedScope, scope, supportSession, progress?.status]);

    useEffect(() => {
        if (!ready || loadedScope !== scope || !progress || busy || supportSession) return;
        const events = readWorkspaceOnboardingActions(scope);
        if (!events.length) return;
        const next = events.reduce((value, event) => applyWorkspaceOnboardingAction(value, event.action), progress);
        const ids = events.map((event) => event.id);
        if (next === progress) discardWorkspaceOnboardingActions(scope, ids);
        else save(next, ids);
    }, [scope, loadedScope, progress, ready, busy, eventRevision, supportSession, save]);

    useEffect(() => {
        if (ready && loadedScope === scope && !busy && !supportSession && page === "canvas" && agentOpen && progress?.status === "active" && progress.step === 2) {
            save(advanceWorkspaceOnboarding(progress, "completed"));
        }
    }, [ready, loadedScope, scope, busy, supportSession, page, agentOpen, progress, save]);

    useEffect(() => {
        setDraftReady(false);
        if (!guideActive || (progress?.step !== 0 && progress?.step !== 3)) return;
        const selector = progress.step === 0 ? '[aria-label^="创作提示词"]' : '.canvas-agent-panel [aria-label="Agent 输入"]';
        const onInput = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.matches(selector)) return;
            const value = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : target.textContent || "";
            setDraftReady(Boolean(value.trim()));
        };
        document.addEventListener("input", onInput);
        return () => document.removeEventListener("input", onInput);
    }, [guideActive, progress?.step, page]);

    if (!ready || loadedScope !== scope || !page || supportSession) return null;
    if (!progress || progress.status !== "active") {
        return (
            <button
                type="button"
                className="workspace-onboarding fixed right-4 top-16 z-40 flex items-center gap-1.5 rounded-full border border-foreground/10 bg-background px-3 py-2 text-xs text-foreground/65 shadow-lg hover:text-foreground focus-visible:outline-2"
                onClick={() => {
                    discardWorkspaceOnboardingActions(
                        scope,
                        readWorkspaceOnboardingActions(scope).map((event) => event.id),
                    );
                    save(newWorkspaceOnboarding());
                }}
                disabled={busy}
            >
                <CircleHelp className="size-4" /> 新手引导
            </button>
        );
    }

    const step = WORKSPACE_ONBOARDING_STEPS[progress.step];
    const last = progress.step === WORKSPACE_ONBOARDING_STEPS.length - 1;
    const detail =
        progress.step === 0 && draftReady && placement?.targetLabel === "选择模型"
            ? "先选择模型；如果当前没有可用模型，可以跳过此步。选择后请查看费用再提交。"
            : progress.step === 0 && draftReady
              ? "选择模型并查看费用，然后点击「开始创作」发送你的想法。引导不会替你提交。"
              : progress.step === 1 && progress.homeLaunchCanvas && page === "canvas"
                ? "刚才的聊天已自动创建画布。你可以前往项目列表，试着手动新建画布，也可以跳过此步。"
                : progress.step === 3 && !agentOpen
                  ? "重新打开画布助手，在输入框写下你的问题或创作要求。是否发送由你决定。"
                  : progress.step === 4 && agentOpen
                    ? "先点击「收起 Agent」，再从画布工具栏添加一个节点。"
                    : progress.step === 4 && placement?.targetLabel === "工具"
                      ? "先点击「工具」展开工具栏，再点击「添加节点」，选择一个节点。"
                      : step.detail;
    return (
        <>
            {placement?.target ? (
                <div
                    aria-hidden="true"
                    className="workspace-onboarding workspace-onboarding-target"
                    style={{ left: placement.target.left, top: placement.target.top, width: placement.target.width, height: placement.target.height, zIndex: agentOpen ? "calc(var(--z-toast) + 2)" : 89 }}
                />
            ) : null}
            <section
                ref={cardRef}
                aria-label="创作工作台新手引导"
                className="workspace-onboarding fixed grid max-h-[calc(100dvh-1.5rem)] w-[min(20rem,calc(100vw-2rem))] gap-3 overflow-auto rounded-2xl border border-foreground/10 bg-background p-4 text-foreground shadow-xl"
                style={{ left: placement?.left ?? 12, top: placement?.top ?? 64, zIndex: agentOpen ? "calc(var(--z-toast) + 3)" : 90 }}
            >
                <header className="flex items-center justify-between gap-3">
                    <span className="text-xs text-foreground/50">
                        新手引导 · {progress.step + 1} / {WORKSPACE_ONBOARDING_STEPS.length}
                    </span>
                    <button type="button" aria-label="关闭新手引导" className="rounded p-1 text-foreground/50 hover:text-foreground focus-visible:outline-2" disabled={busy} onClick={() => save({ ...progress, status: "dismissed" })}>
                        <X className="size-4" />
                    </button>
                </header>
                <div aria-live="polite">
                    <h2 className="m-0 text-sm font-semibold">{step.title}</h2>
                    <p className="mb-0 mt-1.5 text-xs leading-5 text-foreground/65">{detail}</p>
                </div>
                {last ? (
                    <p className="m-0 text-xs text-foreground/55">
                        已操作 {progress.completed.length} 项{progress.skipped.length ? `，跳过 ${progress.skipped.length} 项；你可以随时重新打开引导` : ""}。
                    </p>
                ) : null}
                {step.page === "canvas" && page === "projects" ? (
                    <p className="m-0 text-xs text-foreground/55">请打开画布后继续。</p>
                ) : step.page !== page ? (
                    <button type="button" className="w-fit text-xs text-primary underline underline-offset-4" onClick={() => navigate(step.page === "home" ? "/" : "/canvas")}>
                        {step.page === "home" ? "前往首页" : "前往项目"}
                    </button>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                    <button type="button" className="text-xs text-foreground/50 hover:text-foreground" disabled={busy} onClick={() => save({ ...progress, status: "dismissed" })}>
                        退出引导
                    </button>
                    <div className="flex items-center gap-2">
                        {!last ? (
                            <button type="button" className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs disabled:opacity-40" disabled={busy} onClick={() => save(advanceWorkspaceOnboarding(progress, "skipped"))}>
                                跳过此步
                            </button>
                        ) : null}
                        {progress.step === 3 || last ? (
                            <button
                                type="button"
                                className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
                                style={{ background: "var(--btn-solid-bg)", color: "var(--btn-solid-fg)" }}
                                disabled={busy || (!last && !draftReady)}
                                onClick={() => save(last ? { ...progress, status: "completed" } : advanceWorkspaceOnboarding(progress, "completed"))}
                            >
                                {last ? "完成" : "继续"}
                            </button>
                        ) : null}
                    </div>
                </div>
            </section>
        </>
    );
}
