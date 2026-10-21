import { http } from "@/services/api/request";
import { invalidateAuthSessionCache } from "@/services/api/auth";
import type { LocalUser, SupportSessionInfo } from "@/stores/use-user-store";

export async function startSupportLogin(userId: string, reason: string) {
    const result = await http.post<{ user: LocalUser; supportSession: SupportSessionInfo }>(`/admin/users/${encodeURIComponent(userId)}/support-login`, { reason });
    invalidateAuthSessionCache();
    return result;
}

export async function stopSupportLogin() {
    const result = await http.post<{ user: LocalUser }>("/auth/support-login/stop", {});
    invalidateAuthSessionCache();
    return result;
}
