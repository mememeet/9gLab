export const WORKSPACE_ONBOARDING_KEY = "workspace-onboarding-v2";
export const LEGACY_WORKSPACE_ONBOARDING_KEY = "workspace-onboarding-v1";

export const WORKSPACE_ONBOARDING_STEPS = [
    { title: "在首页发起聊天", detail: "在输入框写下你的想法，选择模型后点击「开始创作」。提交会调用模型，请先查看费用。", page: "home" },
    { title: "新建画布", detail: "打开「项目」，点击「新建画布」。画布会保存你的节点与创作内容。", page: "projects" },
    { title: "打开画布助手", detail: "点击画布上的 Agent 入口，打开助手面板。", page: "canvas" },
    { title: "试着向助手提问", detail: "在 Agent 输入框写下你的问题或创作要求。发送可能产生费用，由你自己决定是否发送。", page: "canvas" },
    { title: "添加一个节点", detail: "收起助手，在画布工具栏点击「添加节点」，选择一个文本、图片或其他节点。", page: "canvas" },
    { title: "开始自由创作", detail: "可以继续编辑节点、使用 Agent 和查看资产。", page: "canvas" },
] as const;

export type WorkspaceOnboardingProgress = { version: 2; step: number; status: "active" | "dismissed" | "completed"; completed: number[]; skipped: number[]; homeLaunchCanvas?: boolean };
export type WorkspaceOnboardingAction = "home-submitted" | "home-launch" | "canvas-created" | "node-created";

export function newWorkspaceOnboarding(): WorkspaceOnboardingProgress {
    return { version: 2, step: 0, status: "active", completed: [], skipped: [] };
}

export function advanceWorkspaceOnboarding(progress: WorkspaceOnboardingProgress, outcome: "completed" | "skipped"): WorkspaceOnboardingProgress {
    if (progress.status !== "active" || progress.step >= WORKSPACE_ONBOARDING_STEPS.length - 1) return progress;
    const other = outcome === "completed" ? "skipped" : "completed";
    return { ...progress, step: progress.step + 1, [outcome]: Array.from(new Set([...progress[outcome], progress.step])), [other]: progress[other].filter((step) => step !== progress.step) };
}

export function applyWorkspaceOnboardingAction(progress: WorkspaceOnboardingProgress, action: WorkspaceOnboardingAction): WorkspaceOnboardingProgress {
    if (progress.status !== "active") return progress;
    if (progress.step === 0 && action === "home-launch") return { ...advanceWorkspaceOnboarding(progress, "completed"), homeLaunchCanvas: true };
    if ((progress.step === 0 && action === "home-submitted") || (progress.step === 1 && action === "canvas-created") || (progress.step === 4 && action === "node-created")) return advanceWorkspaceOnboarding(progress, "completed");
    return progress;
}

export function canvasRouteId(pathname: string): string | null {
    return /^\/canvas\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

export function workspaceOnboardingPage(pathname: string): "home" | "projects" | "canvas" | null {
    if (pathname === "/" || pathname === "/create") return "home";
    if (pathname === "/canvas" || pathname === "/canvas/") return "projects";
    return canvasRouteId(pathname) ? "canvas" : null;
}

export function parseWorkspaceOnboarding(raw: string | null): WorkspaceOnboardingProgress | null {
    if (!raw) return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object") return null;
        const data = value as { version?: number; step?: number; status?: string; completed?: number[]; skipped?: number[]; homeLaunchCanvas?: boolean };
        if (data.version === 1) {
            if (data.status === "dismissed" || data.status === "completed") return { ...newWorkspaceOnboarding(), status: data.status };
            return data.status === "active" ? newWorkspaceOnboarding() : null;
        }
        if (data.version !== 2 || !Number.isInteger(data.step) || (data.step as number) < 0 || (data.step as number) >= WORKSPACE_ONBOARDING_STEPS.length) return null;
        if (data.status !== "active" && data.status !== "dismissed" && data.status !== "completed") return null;
        if (!Array.isArray(data.completed) || !Array.isArray(data.skipped)) return null;
        if ([...data.completed, ...data.skipped].some((step) => !Number.isInteger(step) || step < 0 || step >= WORKSPACE_ONBOARDING_STEPS.length - 1)) return null;
        return { version: 2, step: data.step as number, status: data.status, completed: data.completed, skipped: data.skipped, ...(data.homeLaunchCanvas === true ? { homeLaunchCanvas: true } : {}) };
    } catch {
        return null;
    }
}

export function isNewWorkspaceUser(createdAt: string | undefined, now = Date.now()): boolean {
    if (!createdAt) return false;
    const age = now - Date.parse(createdAt);
    return Number.isFinite(age) && age >= 0 && age < 7 * 24 * 60 * 60 * 1000;
}
