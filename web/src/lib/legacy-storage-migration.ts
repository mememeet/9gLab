// 9gLab 线上浏览器里的配置（含个人渠道与密钥）、画布草稿和媒体缓存仍保存在上游改名前的
// "infinite-canvas" 键与 IndexedDB 库中。首次加载新版本时复制到 "yingce" 名下：
// 已存在的新值不覆盖，旧数据保留，回退旧版本时仍可读取。
const LEGACY_NAME = "infinite-canvas";
const CURRENT_NAME = "yingce";
const LEGACY_KEY_PREFIX = `${LEGACY_NAME}:`;
const CURRENT_KEY_PREFIX = `${CURRENT_NAME}:`;
export const LEGACY_STORAGE_MIGRATION_FLAG = `${CURRENT_KEY_PREFIX}legacy-storage-migrated-v1`;

/** 与各模块 localforage.createInstance / localforage.config 使用的 storeName 保持一致。 */
export const LEGACY_INDEXED_STORE_NAMES = ["app_state", "drawing_documents", "drawing_previews", "drawing_generation_renders", "media_files", "image_files", "resource_blobs", "resource_blob_meta"] as const;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

export function renameLegacyStorageKey(key: string): string {
    return key.startsWith(LEGACY_KEY_PREFIX) ? `${CURRENT_KEY_PREFIX}${key.slice(LEGACY_KEY_PREFIX.length)}` : key;
}

/** 复制 localStorage / sessionStorage 中带旧前缀的键，返回复制条数。 */
export function migrateLegacyWebStorage(storage: KeyValueStorage): number {
    const legacyKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(LEGACY_KEY_PREFIX)) legacyKeys.push(key);
    }
    let copied = 0;
    for (const key of legacyKeys) {
        const target = renameLegacyStorageKey(key);
        const value = storage.getItem(key);
        if (value === null || storage.getItem(target) !== null) continue;
        storage.setItem(target, value);
        copied += 1;
    }
    return copied;
}

async function legacyDatabaseExists(): Promise<boolean> {
    const factory = window.indexedDB;
    if (!factory) return false;
    // 不支持枚举时按存在处理：createInstance 打开不存在的库只会得到空库，不影响正确性。
    if (typeof factory.databases !== "function") return true;
    const databases = await factory.databases();
    return databases.some((database) => database.name === LEGACY_NAME);
}

async function migrateLegacyIndexedStore(localforage: LocalForage, storeName: string): Promise<number> {
    const legacy = localforage.createInstance({ name: LEGACY_NAME, storeName });
    const current = localforage.createInstance({ name: CURRENT_NAME, storeName });
    let copied = 0;
    for (const key of await legacy.keys()) {
        const target = renameLegacyStorageKey(key);
        if ((await current.getItem(target)) !== null) continue;
        const value = await legacy.getItem(key);
        if (value === null) continue;
        await current.setItem(target, value);
        copied += 1;
    }
    return copied;
}

/**
 * 必须在任何持久化 store 创建之前完成；失败时不设置完成标记，下次加载重试。
 * 迁移失败不阻止应用启动，但会在控制台留下可诊断的警告。
 */
export async function migrateLegacyBrowserStorage(): Promise<void> {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
    try {
        if (window.localStorage.getItem(LEGACY_STORAGE_MIGRATION_FLAG) === "1") return;
        migrateLegacyWebStorage(window.localStorage);
        if (typeof window.sessionStorage !== "undefined") migrateLegacyWebStorage(window.sessionStorage);
        if (await legacyDatabaseExists()) {
            // 入口按需加载存储库，避免没有旧数据的访问也为它增加首屏体积。
            const { default: localforage } = await import("localforage");
            for (const storeName of LEGACY_INDEXED_STORE_NAMES) await migrateLegacyIndexedStore(localforage, storeName);
        }
        window.localStorage.setItem(LEGACY_STORAGE_MIGRATION_FLAG, "1");
    } catch (error) {
        console.warn("旧版本浏览器数据迁移失败，将在下次加载时重试", error instanceof Error ? error.message : error);
    }
}
