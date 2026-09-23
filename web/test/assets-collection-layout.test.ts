import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("asset library unified filters", () => {
    test("keeps type, business and folder filters in the shared two-row toolbar", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/pages/assets/official-assets.css"), "utf8");
        expect(page).toContain('className="asset-library-filters" aria-label="素材筛选"');
        expect(page).toContain('<AssetFilterGroup title="类型"');
        expect(page).toContain('<AssetFilterGroup title="分类"');
        expect(page).toContain('aria-label="我的分类"');
        expect(page).toContain('aria-label="新建分类"');
        expect(page).not.toContain('className="assets-collection-layout"');
        expect(css).toMatch(/\.asset-library-filter-row\s*\{[^}]*display:\s*flex/s);
        expect(css).toMatch(/\.asset-library-filter-row\s*\+\s*\.asset-library-filter-row\s*\{[^}]*border-top:/s);
    });
});

describe("wallet history pagination", () => {
    test("pins ledger pagination to the history panel footer", () => {
        const modal = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-wallet-modal.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        expect(modal).toContain("workspace-wallet-history-scroll");
        expect(modal).toContain("workspace-wallet-pagination");
        expect(modal).not.toContain("wallet.total > 20");
        expect(css).toMatch(/\.workspace-wallet-content\.is-history\s*\{[^}]*overflow:\s*hidden/s);
        expect(css).toMatch(/\.workspace-wallet-pagination\s*\{[^}]*margin-top:\s*auto/s);
    });
});
