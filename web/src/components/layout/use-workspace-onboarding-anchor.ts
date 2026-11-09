import { useLayoutEffect, useState, type RefObject } from "react";

type Page = "home" | "projects" | "canvas";
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Placement = { left: number; top: number; target: Rect | null; targetLabel: string | null };

function selectorsForStep(page: Page, step: number, agentOpen: boolean, draftReady: boolean): string[] {
    if (page === "home") {
        if (step === 0) {
            if (!draftReady) return ['[aria-label^="创作提示词"]', ".creation-launchpad"];
            const model = document.querySelector(".creation-launch-model-trigger");
            return model?.textContent?.trim() === "选择模型" ? [".creation-launch-model-trigger", ".creation-submit"] : [".creation-submit", '[aria-label^="创作提示词"]'];
        }
        return ['[data-nav-id="canvas"]', 'button[aria-label="打开侧栏"]'];
    }
    if (page === "projects") {
        if (step === 0) return ['[data-nav-id="home"]', 'button[aria-label="打开侧栏"]'];
        return [".collection-header-actions button"];
    }
    if (step <= 1) return [];
    if (step === 2) return [".canvas-agent-launcher"];
    if (step === 3) return agentOpen ? ['.canvas-agent-panel [aria-label="Agent 输入"]'] : [".canvas-agent-launcher"];
    if (step === 4) return agentOpen ? ['button[aria-label="收起 Agent"]'] : ['button[aria-label="添加节点"]', 'button[aria-label="节点"]', 'button[aria-label="工具"]'];
    return ['button[aria-label="资产视图"]', 'button[aria-label="素材库"]', 'button[aria-label="退出专注模式"]'];
}

export function placeWorkspaceOnboarding(target: Rect, card: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
    const margin = 12;
    const gap = 12;
    const candidates = [
        { left: target.left + (target.width - card.width) / 2, top: target.bottom + gap },
        { left: target.left + (target.width - card.width) / 2, top: target.top - card.height - gap },
        { left: target.right + gap, top: target.top + (target.height - card.height) / 2 },
        { left: target.left - card.width - gap, top: target.top + (target.height - card.height) / 2 },
    ];
    const overflow = (point: { left: number; top: number }) =>
        Math.max(0, margin - point.left) + Math.max(0, margin - point.top) + Math.max(0, point.left + card.width + margin - viewport.width) + Math.max(0, point.top + card.height + margin - viewport.height);
    const best = candidates.reduce((current, candidate) => (overflow(candidate) < overflow(current) ? candidate : current));
    return {
        left: Math.round(Math.max(margin, Math.min(best.left, viewport.width - card.width - margin))),
        top: Math.round(Math.max(margin, Math.min(best.top, viewport.height - card.height - margin))),
    };
}

export function useWorkspaceOnboardingAnchor(page: Page | null, step: number, agentOpen: boolean, draftReady: boolean, enabled: boolean, cardRef: RefObject<HTMLElement | null>): Placement | null {
    const [placement, setPlacement] = useState<Placement | null>(null);

    useLayoutEffect(() => {
        if (!enabled || !page || !cardRef.current) return;
        const activePage = page;
        let frame = 0;
        let observedTarget: Element | null = null;
        let scrolled = false;
        const targetObserver = new window.MutationObserver(schedule);
        const resizeObserver = typeof window.ResizeObserver === "undefined" ? null : new window.ResizeObserver(schedule);
        resizeObserver?.observe(cardRef.current);

        function update() {
            frame = 0;
            const card = cardRef.current;
            if (!card) return;
            const candidates = selectorsForStep(activePage, step, agentOpen, draftReady).flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
            const visible = candidates.filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).visibility !== "hidden";
            });
            const inViewport = visible.find((element) => {
                const rect = element.getBoundingClientRect();
                return rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
            });
            const target = inViewport ?? visible[0] ?? null;
            if (target && !scrolled) {
                scrolled = true;
                if (!inViewport) target.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
            if (target !== observedTarget) {
                targetObserver.disconnect();
                if (observedTarget) resizeObserver?.unobserve(observedTarget);
                observedTarget = target;
                if (target) {
                    targetObserver.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
                    resizeObserver?.observe(target);
                }
            }
            const rect = target?.getBoundingClientRect();
            const anchor =
                rect && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
                    ? {
                          left: Math.max(0, rect.left),
                          top: Math.max(0, rect.top),
                          right: Math.min(window.innerWidth, rect.right),
                          bottom: Math.min(window.innerHeight, rect.bottom),
                          width: Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left),
                          height: Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top),
                      }
                    : null;
            const position = anchor ? placeWorkspaceOnboarding(anchor, card.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }) : { left: 12, top: 64 };
            const next = { ...position, target: anchor, targetLabel: anchor ? target?.getAttribute("aria-label") || target?.textContent?.trim() || null : null };
            setPlacement((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
        }

        function schedule() {
            if (!frame) frame = window.requestAnimationFrame(update);
        }

        const treeObserver = new window.MutationObserver(schedule);
        treeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-expanded", "hidden"] });
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        update();
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            treeObserver.disconnect();
            targetObserver.disconnect();
            resizeObserver?.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
        };
    }, [page, step, agentOpen, draftReady, enabled, cardRef]);

    return enabled ? placement : null;
}
