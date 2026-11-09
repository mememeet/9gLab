import { useUserStore } from "@/stores/use-user-store";
import type { WorkspaceOnboardingAction } from "@/lib/workspace-onboarding";

export const WORKSPACE_ONBOARDING_EVENT = "workspace-onboarding-action";
type ActionEvent = { id: string; action: WorkspaceOnboardingAction };
const keyFor = (scope: string) => `workspace-onboarding-actions:${scope}`;
const activeKeyFor = (scope: string) => `workspace-onboarding-active:${scope}`;

export function setWorkspaceOnboardingActive(scope: string, active: boolean) {
    try {
        if (active) sessionStorage.setItem(activeKeyFor(scope), "1");
        else sessionStorage.removeItem(activeKeyFor(scope));
    } catch {
        // 浏览器存储不可用时不影响创作。
    }
}

export function readWorkspaceOnboardingActions(scope: string): ActionEvent[] {
    try {
        const value: unknown = JSON.parse(sessionStorage.getItem(keyFor(scope)) || "[]");
        return Array.isArray(value) ? value.filter((item): item is ActionEvent => item && typeof item.id === "string" && ["home-submitted", "home-launch", "canvas-created", "node-created"].includes(item.action)).slice(-20) : [];
    } catch {
        return [];
    }
}

export function discardWorkspaceOnboardingActions(scope: string, ids: string[]) {
    try {
        const remaining = readWorkspaceOnboardingActions(scope).filter((event) => !ids.includes(event.id));
        sessionStorage.setItem(keyFor(scope), JSON.stringify(remaining));
    } catch {
        // 引导不可用不应阻断创作。
    }
}

export function reportWorkspaceOnboardingAction(action: WorkspaceOnboardingAction) {
    if (typeof window === "undefined") return;
    try {
        const userState = useUserStore.getState();
        const scope = userState.user?.id?.trim();
        if (!scope || userState.supportSession) return;
        if (sessionStorage.getItem(activeKeyFor(scope)) !== "1") return;
        const events = readWorkspaceOnboardingActions(scope);
        events.push({ id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, action });
        sessionStorage.setItem(keyFor(scope), JSON.stringify(events.slice(-20)));
        window.dispatchEvent(new Event(WORKSPACE_ONBOARDING_EVENT));
    } catch {
        // 引导不可用不应阻断创作。
    }
}
