import { describe, expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

describe("official asset library", () => {
    test("keeps official and personal assets as explicit peer views", async () => {
        const [assetsPage, officialView, tabs, styles] = await Promise.all([
            source("../src/pages/assets/index.tsx"),
            source("../src/pages/assets/official-assets-view.tsx"),
            source("../src/pages/assets/asset-library-tabs.tsx"),
            source("../src/pages/assets/official-assets.css"),
        ]);

        expect(assetsPage).toContain('useState<AssetLibraryScope>("official")');
        expect(assetsPage).toContain('<AssetLibraryTabs value="personal"');
        expect(officialView).toContain('<AssetLibraryTabs value="official"');
        expect(officialView).toContain("加入我的资产");
        expect(officialView).toContain("setOfficialAssetFavorite");
        expect(officialView).toContain("asset-library-unified");
        expect(assetsPage).toContain("asset-library-unified");
        expect(officialView).toContain("asset-library-unified-card");
        expect(assetsPage).toContain("asset-library-unified-card");
        expect(tabs).toContain("官方资产");
        expect(tabs).toContain("我的资产");
        expect(styles).toContain(".asset-library-unified .asset-library-unified-card");
    });

    test("exposes the admin publishing workflow and does not accept browser-only files", async () => {
        const [adminPage, router, navigation] = await Promise.all([
            source("../src/pages/admin/official-assets/official-assets-page.tsx"),
            source("../src/router.tsx"),
            source("../src/pages/admin/components/admin-shell.tsx"),
        ]);

        expect(adminPage).toContain("resourceIdFromStorageKey(uploaded.storageKey)");
        expect(adminPage).toContain("文件未上传到服务器");
        expect(adminPage).toContain("updateOfficialAssetStatus");
        expect(adminPage).toContain("被用户加入后不能替换底层文件");
        expect(router).toContain('path: "official-assets", element: <OfficialAssetsAdminPage />');
        expect(navigation).toContain('path: "/admin/official-assets", label: "官方资产库"');
    });

    test("uses the protected materialization and media endpoints", async () => {
        const api = await source("../src/services/api/official-assets.ts");

        expect(api).toContain('http.post<{ asset: Asset }>(`/official-assets/${encodeURIComponent(id)}/materialize`)');
        expect(api).toContain('http.patch<{ asset: OfficialAsset }>(`/admin/official-assets/${encodeURIComponent(id)}/status`');
        expect(api).not.toContain("storageKey:");
    });
});
