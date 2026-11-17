import { lazy, Suspense, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { useAgentPanelDock } from "@/components/canvas/use-agent-panel-dock";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";
import { YoruWidget } from "@/components/layout/yoru-widget";
import { WorkspaceOnboarding } from "@/components/layout/workspace-onboarding";
import { canvasRouteId } from "@/lib/workspace-onboarding";

const workspaceTheme = getWorkspaceAntThemeConfig();
// 画布助手按需加载，执行任务由服务端管理，不随面板卸载取消。
const GlobalAgentPanel = lazy(() => import("@/components/canvas/canvas-cloud-agent-panel").then((module) => ({ default: module.CanvasCloudAgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const productWorkspace = !adminWorkspace && !canvasEditor;
    const userId = useUserStore((state) => state.user?.id);
    const canvasId = canvasRouteId(pathname);
    const agentCanvasId = useGlobalAgentStore((state) => state.canvas?.canvasId);
    const previousCanvasId = useRef(canvasId);
    // Agent 停靠在画布右侧时，工作区让出同样的宽度，画布、顶栏和角落控件都不被遮挡。
    const agentDock = useAgentPanelDock();
    const agentDocked = Boolean(userId) && canvasEditor && agentDock.active;
    const creationWorkspace = pathname === "/" || pathname === "/create";
    const wasCanvasEditorRef = useRef(canvasEditor);
    // 从画布编辑器回到创作首页时收起 Agent：画布里停靠在右侧的面板到首页会变成浮窗，挡住首页。
    // 只收起面板，对话和运行照常继续；在绘制前收起，首页不会先闪出浮窗。
    useLayoutEffect(() => {
        const leftCanvasEditor = wasCanvasEditorRef.current && !canvasEditor;
        wasCanvasEditorRef.current = canvasEditor;
        if (leftCanvasEditor && creationWorkspace) useGlobalAgentStore.getState().closeAgent();
    }, [canvasEditor, creationWorkspace]);

    useLayoutEffect(() => {
        if (previousCanvasId.current && !canvasId) useGlobalAgentStore.getState().closeAgent();
        previousCanvasId.current = canvasId;
    }, [canvasId]);

    useLayoutEffect(() => {
        // Ant Design 浮层挂载在 body，必须用路由级标记隔离用户工作台与画布编辑器、运营后台。
        document.body.classList.toggle("app-user-overlays", !adminWorkspace);
        document.body.classList.toggle("app-spatial-overlays", spatialWorkbench);
        document.body.classList.toggle("app-product-overlays", productWorkspace);
        return () => {
            document.body.classList.remove("app-user-overlays");
            document.body.classList.remove("app-spatial-overlays");
            document.body.classList.remove("app-product-overlays");
        };
    }, [adminWorkspace, spatialWorkbench, productWorkspace]);

    // 画布上下文发布完成后挂载专属面板；切换画布会恢复该画布自己的快照。
    const globalAgent =
        userId && canvasId && agentCanvasId === canvasId ? (
            <Suspense fallback={null}>
                <GlobalAgentPanel key={`${userId}:${canvasId}`} />
            </Suspense>
        ) : null;

    if (adminWorkspace)
        return (
            <>
                {children}
                {globalAgent}
            </>
        );

    return (
        <ConfigProvider
            theme={productWorkspace ? workspaceTheme : undefined}
            select={productWorkspace ? { classNames: { popup: { root: "workspace-quiet-popup" } } } : undefined}
            dropdown={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
            popover={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
        >
            <div
                className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace", productWorkspace && "app-product-workspace")}
                style={{ height: "calc(100dvh - var(--support-session-banner-height, 0px))", paddingRight: agentDocked ? agentDock.width : undefined }}
                data-agent-docked={agentDocked || undefined}
            >
                <AppWorkspaceShell>{children}</AppWorkspaceShell>
            </div>
            <YoruWidget />
            {globalAgent}
            {userId ? <WorkspaceOnboarding /> : null}
        </ConfigProvider>
    );
}
