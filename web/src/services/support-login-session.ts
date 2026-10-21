import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence } from "@/stores/use-asset-store";
import { withGenerationConsumersPaused } from "@/services/generation-consumer-lifecycle";
import { hasRemoteUserDataSyncSession, resetRemoteUserDataSync, saveRemoteUserDataNow, withRemoteUserDataSyncExclusive } from "@/services/user-data-sync";
import { ApiError } from "@/services/api/request";
import { SUPPORT_SESSION_CHANGE_KEY } from "@/lib/support-session";

export async function changeSupportIdentity(operation: () => Promise<unknown>, destination: string, restoring = false) {
    await withGenerationConsumersPaused(async () => {
        if (hasRemoteUserDataSyncSession()) {
            try {
                await saveRemoteUserDataNow();
            } catch (error) {
                if (!restoring || !(error instanceof ApiError) || ![401, 403, 409].includes(error.status || 0)) throw error;
            }
        }
        await withRemoteUserDataSyncExclusive(async () => {
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            await operation();
            resetRemoteUserDataSync();
            // Other tabs reload; requests sent by their old mounted identity fail closed on the server.
            window.localStorage.setItem(SUPPORT_SESSION_CHANGE_KEY, crypto.randomUUID());
            window.location.assign(destination);
        });
    });
}
