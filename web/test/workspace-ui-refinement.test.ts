import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const createPagePath = new URL("../src/pages/create/index.tsx", import.meta.url);
const composerPath = new URL("../src/pages/create/creation-workspace.tsx", import.meta.url);
const canvasLibraryPath = new URL("../src/pages/canvas/index.tsx", import.meta.url);
const canvasProjectPath = new URL("../src/pages/canvas/project.tsx", import.meta.url);
const skillsPath = new URL("../src/pages/skills/index.tsx", import.meta.url);
const assetsPath = new URL("../src/pages/assets/index.tsx", import.meta.url);
const assetsStylesPath = new URL("../src/pages/assets/official-assets.css", import.meta.url);
const stylesPath = new URL("../src/styles/globals.css", import.meta.url);

describe("workspace UI refinement", () => {
    test("keeps the empty creation home quiet and lower on the page", async () => {
        const [page, composer, styles] = await Promise.all([
            readFile(createPagePath, "utf8"),
            readFile(composerPath, "utf8"),
            readFile(stylesPath, "utf8"),
        ]);

        const emptyHome = page.slice(page.indexOf("{isEmpty ? <>"), page.indexOf("</> : <div className=\"creation-thread-workbench\">"));
        expect(emptyHome).not.toContain("查看历史对话");
        expect(composer).toContain('props.variant === "empty" ? " is-spotlight-disabled"');
        expect(styles).toContain(".creation-chat-composer.is-spotlight-disabled > span");
        expect(styles).toContain("padding-top: clamp(64px, 8vh, 108px) !important");
    });

    test("offers only search plus the existing local, LibTV, and TapNow import paths", async () => {
        const [library, project] = await Promise.all([
            readFile(canvasLibraryPath, "utf8"),
            readFile(canvasProjectPath, "utf8"),
        ]);

        expect(library).toContain("导入本地画布包");
        expect(library).toContain("导入 LibTV 画布");
        expect(library).toContain("导入 TapNow 画布");
        expect(library).not.toContain("更多画布操作");
        expect(library).not.toContain("按所属项目筛选");
        expect(library).not.toContain("画布排序");
        expect(library).not.toContain(">创作历史</Button>");
        expect(project).toContain('searchParams.get("import")');
        expect(project).toContain("setLibTVImportOpen(true)");
        expect(project).toContain("setTapNowImportOpen(true)");
    });

    test("uses a media-first Skill gallery without removing skill actions", async () => {
        const [skills, styles] = await Promise.all([
            readFile(skillsPath, "utf8"),
            readFile(stylesPath, "utf8"),
        ]);

        expect(skills).toContain("skills-design-header");
        expect(skills).toContain("skills-category-chips");
        expect(skills).toContain("skill.showcaseMedia?.[0]");
        expect(skills).toContain("加入技能库");
        expect(skills).toContain("编辑技能");
        expect(skills).toContain("删除技能");
        expect(skills).toContain("导入 Skill");
        expect(skills).toContain("创建 Skill");
        expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
        expect(styles).toContain(".assets-library-page .app-page-header");
    });

    test("keeps personal assets spacious while preserving library actions", async () => {
        const [assets, styles] = await Promise.all([
            readFile(assetsPath, "utf8"),
            readFile(assetsStylesPath, "utf8"),
        ]);

        expect(assets).toContain("asset-library-unified");
        expect(assets).toContain("asset-library-topline");
        expect(assets).toContain("asset-library-filter-row");
        expect(assets).not.toContain('<aside className="assets-collection-filters"');
        expect(assets).toContain('{ label: "舒适", value: 4 }');
        expect(assets).toContain('{ label: "紧凑", value: 5 }');
        expect(assets).toContain("上传图片");
        expect(assets).toContain("导入素材包");
        expect(assets).toContain("上传 3D 模型");
        expect(assets).toContain("导出全部素材");
        expect(assets).toContain("moveRemoteAssetsToFolder");
        expect(styles).toContain(".asset-library-unified .assets-library-grid");
        expect(styles).toContain("var(--asset-library-columns, var(--assets-grid-columns, 4))");
        expect(styles).toContain(".asset-library-detail-modal .ant-modal-content");
    });
});
