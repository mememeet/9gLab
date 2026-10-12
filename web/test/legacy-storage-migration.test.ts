import { describe, expect, test } from "bun:test";

import { migrateLegacyWebStorage, renameLegacyStorageKey } from "../src/lib/legacy-storage-migration";

function memoryStorage(initial: Record<string, string>) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get length() {
            return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
    };
}

describe("legacy browser storage migration", () => {
    test("renames only keys with the pre-rename prefix", () => {
        expect(renameLegacyStorageKey("infinite-canvas:config_store:user:u1")).toBe("yingce:config_store:user:u1");
        expect(renameLegacyStorageKey("canvas-agent-launch-v1:abc")).toBe("canvas-agent-launch-v1:abc");
        expect(renameLegacyStorageKey("infinite-canvas-skin")).toBe("infinite-canvas-skin");
    });

    test("copies legacy keys without overwriting newer values or deleting old ones", () => {
        const storage = memoryStorage({
            "infinite-canvas:theme_store": '{"state":{"theme":"dark"}}',
            "infinite-canvas:workspace-sidebar-collapsed": "1",
            "yingce:workspace-sidebar-collapsed": "0",
            unrelated: "x",
        });
        expect(migrateLegacyWebStorage(storage)).toBe(1);
        expect(storage.values.get("yingce:theme_store")).toBe('{"state":{"theme":"dark"}}');
        expect(storage.values.get("yingce:workspace-sidebar-collapsed")).toBe("0");
        expect(storage.values.get("infinite-canvas:theme_store")).toBe('{"state":{"theme":"dark"}}');
        expect(storage.values.has("unrelated")).toBe(true);
        expect(migrateLegacyWebStorage(storage)).toBe(0);
    });
});
