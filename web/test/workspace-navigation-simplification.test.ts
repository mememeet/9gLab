import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("workspace navigation simplification", () => {
    test("uses the requested labels and removes the short drama entry", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const navigation = source.slice(source.indexOf("function buildNav"), source.indexOf("function WorkspaceSidebarProfile"));

        expect(navigation).toContain('id: "home", title: "首页"');
        expect(navigation).toContain('toolItem("canvas", "/canvas"), title: "项目"');
        expect(navigation).toContain('toolItem("assets", "/assets"), title: "资产"');
        expect(navigation).toContain('toolItem("skills", "/skills"), title: "技能"');
        expect(navigation).toContain('heading: "资源与工具"');
        expect(navigation).toContain('title: "插件"');
        expect(navigation).toContain('title: "创作历史"');
        expect(navigation).not.toContain("短剧 Agent");
        expect(navigation).not.toContain('toolItem("projects", "/projects")');
    });
});
