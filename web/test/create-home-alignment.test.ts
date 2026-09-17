import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const createPagePath = new URL("../src/pages/create/index.tsx", import.meta.url);
const discoveryPath = new URL("../src/pages/create/create-home-discovery.tsx", import.meta.url);
const discoveryCSSPath = new URL("../src/pages/create/create-home.css", import.meta.url);

describe("MiniMax-aligned creation home", () => {
    test("removes the retired banner and shortcut grid from the empty home", async () => {
        const source = await readFile(createPagePath, "utf8");

        expect(source).not.toContain("CreationEmptyBanner");
        expect(source).not.toContain("CreationEmptySuggest");
        expect(source).not.toContain("生成第一个镜头");
        expect(source).toContain("<CreationHomeDiscovery");
    });

    test("offers inspiration and real added skills without changing generation submission", async () => {
        const [page, discovery] = await Promise.all([
            readFile(createPagePath, "utf8"),
            readFile(discoveryPath, "utf8"),
        ]);

        expect(discovery).toContain('type DiscoveryTab = "inspiration" | "skill"');
        expect(discovery).toContain("CREATION_INSPIRATIONS");
        expect(discovery).toContain('role="tablist"');
        expect(discovery).toContain("skills.filter((skill) => skill.isAdded).slice(0, 8)");
        expect(discovery).toContain("onUsePrompt(item.prompt)");
        expect(discovery).toContain("onUseSkill(skill)");
        expect(page).toContain("canvasSkillMentionToken(skill.skillId)");
        expect(page).toContain("<CreationComposer {...composerProps} variant=\"empty\" />");
    });

    test("uses the frozen typography colors and responsive MiniMax media grid", async () => {
        const css = await readFile(discoveryCSSPath, "utf8");

        expect(css).toContain("--creation-text: var(--text-primary)");
        expect(css).toContain("--creation-muted: var(--text-secondary)");
        expect(css).toContain("--creation-faint: var(--text-tertiary)");
        expect(css).toContain("font-size: 20px");
        expect(css).toContain("line-height: var(--lh-heading-lg)");
        expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
        expect(css).toContain("@media (max-width: 760px)");
        expect(css).toContain("@media (max-width: 480px)");
        expect(css).not.toMatch(/font-weight:\s*(?:[1-3]\d{2}|4[1-9]\d|5[1-9]\d|6[1-9]\d|7[1-9]\d|[89]\d{2})/);
    });
});
