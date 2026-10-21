import { useEffect, useState, type ReactNode } from "react";
import { App, Button } from "antd";
import { useUserStore } from "@/stores/use-user-store";
import { SUPPORT_SESSION_CHANGE_KEY } from "@/lib/support-session";
import { ApiError } from "@/services/api/request";
import "./support-session.css";

export function SupportSessionBoundary({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const support = useUserStore((state) => state.supportSession);
    const canRestore = useUserStore((state) => state.supportRestoreAvailable);
    const [now, setNow] = useState(Date.now);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const reload = (event: StorageEvent) => {
            if (event.key !== SUPPORT_SESSION_CHANGE_KEY) return;
            useUserStore.getState().setHydrated(false);
            window.location.reload();
        };
        window.addEventListener("storage", reload);
        return () => window.removeEventListener("storage", reload);
    }, []);

    useEffect(() => {
        if (!support) return;
        const interval = window.setInterval(() => setNow(Date.now()), 1_000);
        const timeout = window.setTimeout(() => window.location.reload(), Math.max(0, Date.parse(support.expiresAt) - Date.now()) + 100);
        return () => {
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [support]);

    async function restore() {
        if (busy) return;
        setBusy(true);
        try {
            const [{ changeSupportIdentity }, { stopSupportLogin }] = await Promise.all([import("@/services/support-login-session"), import("@/services/api/support-login")]);
            await changeSupportIdentity(stopSupportLogin, "/admin/users", true);
        } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status || 0)) {
                window.localStorage.setItem(SUPPORT_SESSION_CHANGE_KEY, crypto.randomUUID());
                window.location.assign("/login");
                return;
            }
            message.error(error instanceof Error ? error.message : "无法恢复管理员身份");
            setBusy(false);
        }
    }

    if (!support && !canRestore) return children;
    const seconds = support ? Math.max(0, Math.ceil((Date.parse(support.expiresAt) - now) / 1_000)) : 0;
    const remaining = `${Math.floor(seconds / 3_600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    return (
        <div className="support-session-shell">
            <div className="support-session-banner" role="region" aria-label="管理员临时代登">
                <div className="min-w-0">
                    <div className="truncate font-medium">{support ? `临时代登 · ${support.targetName || support.targetUsername}（@${support.targetUsername}）` : "临时代登已结束"}</div>
                    <div className="truncate text-xs" title={support?.reason}>
                        {support ? `剩余 ${remaining} · 修改保存到用户账号，生成使用用户积分` : "返回管理员身份后可继续排查"}
                    </div>
                </div>
                <Button size="small" loading={busy} onClick={() => void restore()}>
                    返回管理员
                </Button>
            </div>
            <div inert={busy} style={{ display: "contents" }}>
                {children}
            </div>
            {busy && (
                <div className="support-session-transition" role="status" tabIndex={-1} ref={(node) => node?.focus()} onKeyDownCapture={(event) => event.stopPropagation()}>
                    正在返回管理员…
                </div>
            )}
        </div>
    );
}
