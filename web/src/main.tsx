import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { isIsolatedPrevisRepro } from "@/lib/dev-repro";
import { migrateLegacyBrowserStorage } from "@/lib/legacy-storage-migration";

installChunkRecovery();

// 持久化 store 在应用模块加载时立即读取浏览器存储，旧版数据必须先迁移到新名字下。
const legacyStorageReady = migrateLegacyBrowserStorage();

// The public film entry checks its availability independently of workspace bootstrap.
if (/^\/welcome\/?$/.test(window.location.pathname)) {
    void bootstrapAppearance().catch(() => undefined);
    void legacyStorageReady.then(() => import("./welcome-application"));
} else {
    // The backend-free DEV lab must not make requests before AppProviders isolates it.
    const appearanceReady = isIsolatedPrevisRepro(import.meta.env.DEV, window.location.pathname) ? Promise.resolve() : bootstrapAppearance();
    void legacyStorageReady.then(() => import("./application"));
    void appearanceReady.catch(() => undefined);
}
