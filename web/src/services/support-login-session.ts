import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence } from "@/stores/use-asset-store";
import { withGenerationConsumersPaused } from "@/services/generation-consumer-lifecycle";
import { hasRemoteUserDataSyncSession, resetRemoteUserDataSync, saveRemoteUserDataNow, withRemoteUserDataSyncExclusive } from "@/services/user-data-sync";
import { ApiError } from "@/services/api/request";
import { SUPPORT_SESSION_CHANGE_KEY } from "@/lib/support-session";

export class SupportLoginCloudSaveError extends Error {
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : "当前工作区未能保存到云端", { cause });
        this.name = "SupportLoginCloudSaveError";
    }
}

export async function changeSupportIdentity(operation: () => Promise<unknown>, destination: string, restoring = false, options: { saveLocallyOnly?: boolean } = {}) {
    await withGenerationConsumersPaused(async () => {
        if (!options.saveLocallyOnly && hasRemoteUserDataSyncSession()) {
            try {
                await saveRemoteUserDataNow();
            } catch (error) {
                if (error instanceof ApiError && [401, 403, 409].includes(error.status || 0)) {
                    if (!restoring) throw error;
                } else {
                    throw new SupportLoginCloudSaveError(error);
                }
            }
        }
        await withRemoteUserDataSyncExclusive(async () => {
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            await operation();
            // Reset only in-memory sync state; the old account's scoped cache and
            // pending mutation journal remain available when returning to it.
            resetRemoteUserDataSync();
            // Other tabs reload; requests sent by their old mounted identity fail closed on the server.
            window.localStorage.setItem(SUPPORT_SESSION_CHANGE_KEY, crypto.randomUUID());
            window.location.assign(destination);
        });
    });
}
