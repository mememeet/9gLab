import { useUserStore } from "@/stores/use-user-store";

export function requestIdentityHeaders(): Record<string, string> {
    const userId = useUserStore.getState().user?.id;
    return userId ? { "X-Canvas-User-ID": userId } : {};
}
