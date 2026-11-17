import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { WorkspaceForbiddenState } from "@/components/layout/workspace-state";
import { useUserStore } from "@/stores/use-user-store";

export function RequireSkillAdmin({ children }: { children: ReactNode }) {
    const allowed = useUserStore((state) => state.hydrated && state.user?.role === "admin" && state.user.status === "active");
    return <RequireAuth>{allowed ? children : <WorkspaceForbiddenState description="技能库仅供管理员查看和管理。" />}</RequireAuth>;
}
