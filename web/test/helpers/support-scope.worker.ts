import { getActiveUserScope, scopedStorageKey, setActiveUserScope } from "../../src/lib/user-scope";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
setActiveUserScope("admin-user");
values.set("yingce:active-user-scope", "target-user");
const pinned = getActiveUserScope();
const before = scopedStorageKey("canvas");
setActiveUserScope("target-user");
self.postMessage({ pinned, before, after: scopedStorageKey("canvas") });
