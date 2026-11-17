package repository

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestOfficialAssetCompatibilityAcrossCatalogPaths(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.OfficialAsset{}, &model.OfficialAssetMedia{}, &model.OfficialAssetImport{}, &model.UserOfficialAssetUse{}, &model.Resource{}))
	repo := New(db)
	now := time.Now().UTC()
	legacy := &model.OfficialAsset{ID: "legacy", Title: "原有素材", Kind: "image", Status: model.OfficialAssetStatusPublished, CreatedAt: now}
	media := []model.OfficialAssetMedia{{ID: "primary", OfficialAssetID: legacy.ID, ResourceID: "image-one", Role: "primary"}, {ID: "alternate", OfficialAssetID: legacy.ID, ResourceID: "image-two", Role: "alternate", Position: 1}}
	require.NoError(t, repo.CreateOfficialAsset(legacy, media))
	stored, err := repo.OfficialAssetByID(legacy.ID)
	require.NoError(t, err)
	require.Equal(t, "image", stored.MediaType)
	require.Equal(t, "image-one", stored.ResourceID)
	require.Len(t, stored.Media, 2)
	byAlternate, err := repo.OfficialAssetByResourceID("image-two")
	require.NoError(t, err)
	require.Equal(t, legacy.ID, byAlternate.ID)
	require.NoError(t, db.Create(&model.Resource{ID: "image-two", UserID: "owner", Status: model.ResourceStatusReady}).Error)
	public, err := repo.PublishedOfficialResource("image-two")
	require.NoError(t, err)
	require.True(t, public)
	require.NoError(t, db.Create(&model.UserOfficialAssetUse{ID: "use", UserID: "user", OfficialAssetID: legacy.ID, AssetID: "copy"}).Error)
	imported, err := repo.OfficialAssetImportedByUser(legacy.ID, "user")
	require.NoError(t, err)
	require.True(t, imported)
	count, err := repo.OfficialAssetImportCount(legacy.ID)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)

	upstream := &model.OfficialAsset{ID: "upstream", Title: "单资源素材", MediaType: "image", ResourceID: "image-three", Status: model.OfficialAssetStatusPublished, CreatedAt: now}
	require.NoError(t, repo.CreateOfficialAsset(upstream))
	stored, err = repo.OfficialAsset(upstream.ID)
	require.NoError(t, err)
	require.Equal(t, "image", stored.Kind)
	require.Len(t, stored.Media, 1)
	require.Equal(t, "image-three", stored.Media[0].ResourceID)
}

func TestOfficialRecommendationCreatesCompatibleMediaAtomically(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.OfficialAsset{}, &model.OfficialAssetMedia{}, &model.OfficialAssetRecommendation{}))
	repo := New(db)
	recommendation := model.OfficialAssetRecommendation{ID: "recommendation", Status: model.OfficialAssetRecommendationPending}
	require.NoError(t, db.Create(&recommendation).Error)
	asset := &model.OfficialAsset{ID: "approved", MediaType: "image", ResourceID: "resource", SourceName: "来源", LicenseNote: "授权", Status: model.OfficialAssetStatusPublished}
	require.NoError(t, repo.ApproveOfficialAssetRecommendation(recommendation.ID, asset, map[string]any{"status": model.OfficialAssetRecommendationApproved, "official_asset_id": asset.ID}))
	stored, err := repo.OfficialAsset(asset.ID)
	require.NoError(t, err)
	require.Equal(t, "image", stored.Kind)
	require.Equal(t, "来源", stored.Source)
	require.Equal(t, "授权", stored.License)
	require.Len(t, stored.Media, 1)
	require.Equal(t, "resource", stored.Media[0].ResourceID)

	duplicate := &model.OfficialAsset{ID: "duplicate", MediaType: "image", ResourceID: "another-resource"}
	require.Error(t, repo.ApproveOfficialAssetRecommendation(recommendation.ID, duplicate, map[string]any{"status": model.OfficialAssetRecommendationApproved}))
	var count int64
	require.NoError(t, db.Model(&model.OfficialAsset{}).Where("id = ?", duplicate.ID).Count(&count).Error)
	require.Zero(t, count)
}

func TestOfficialAssetImportPathsShareDeduplication(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	verifyOfficialAssetImportPathsShareDeduplication(t, db)
}

func TestPostgresOfficialAssetImportPathsShareDeduplication(t *testing.T) {
	verifyOfficialAssetImportPathsShareDeduplication(t, ecommerceBatchTestPostgres(t))
}

func verifyOfficialAssetImportPathsShareDeduplication(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.OfficialAssetImport{}, &model.UserOfficialAssetUse{}))
	repo := New(db)
	asset := &model.Asset{ID: "local-copy", UserID: "user", Kind: "image", PayloadJSON: `{}`}
	use := &model.UserOfficialAssetUse{ID: "local-use", UserID: "user", OfficialAssetID: "official", AssetID: asset.ID}
	require.NoError(t, repo.CreateOfficialAssetMaterialization(asset, use))
	imported, err := repo.ImportRecord(model.OfficialAssetImportScopeLibrary, "user", "official")
	require.NoError(t, err)
	require.Equal(t, asset.ID, imported.AssetID)
	count, err := repo.OfficialAssetImportCount("official")
	require.NoError(t, err)
	require.EqualValues(t, 1, count)

	duplicate := &model.Asset{ID: "duplicate", UserID: "user", Kind: "image", PayloadJSON: `{}`}
	version := &model.AssetVersion{ID: "version", AssetID: duplicate.ID, Version: 1}
	representation := &model.AssetRepresentation{ID: "representation", AssetVersionID: version.ID, Role: "primary"}
	record := &model.OfficialAssetImport{ID: "import", Scope: model.OfficialAssetImportScopeLibrary, OwnerID: "user", OfficialAssetID: "official", AssetID: duplicate.ID}
	require.Error(t, repo.CreateImportedLibraryAsset(duplicate, version, representation, record))
	count = 0
	require.NoError(t, db.Model(&model.Asset{}).Where("id = ?", duplicate.ID).Count(&count).Error)
	require.Zero(t, count)

	second := &model.Asset{ID: "upstream-copy", UserID: "user", Kind: "image", PayloadJSON: `{}`}
	version = &model.AssetVersion{ID: "version-two", AssetID: second.ID, Version: 1}
	representation = &model.AssetRepresentation{ID: "representation-two", AssetVersionID: version.ID, Role: "primary"}
	record = &model.OfficialAssetImport{ID: "import-two", Scope: model.OfficialAssetImportScopeLibrary, OwnerID: "user", OfficialAssetID: "other-official", AssetID: second.ID}
	require.NoError(t, repo.CreateImportedLibraryAsset(second, version, representation, record))
	storedUse, err := repo.OfficialAssetUseForUser("user", "other-official")
	require.NoError(t, err)
	require.Equal(t, second.ID, storedUse.AssetID)
}

func TestPostgresOfficialAssetImportPathsCompete(t *testing.T) {
	db := ecommerceBatchTestPostgres(t)
	require.NoError(t, db.AutoMigrate(&model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.OfficialAssetImport{}, &model.UserOfficialAssetUse{}))
	repo := New(db)
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		<-start
		asset := &model.Asset{ID: "legacy-copy", UserID: "user", Kind: "image", PayloadJSON: `{}`}
		use := &model.UserOfficialAssetUse{ID: "legacy-use", UserID: "user", OfficialAssetID: "official", AssetID: asset.ID}
		results <- repo.CreateOfficialAssetMaterialization(asset, use)
	}()
	go func() {
		defer workers.Done()
		<-start
		asset := &model.Asset{ID: "upstream-copy", UserID: "user", Kind: "image", PayloadJSON: `{}`}
		version := &model.AssetVersion{ID: "version", AssetID: asset.ID, Version: 1}
		representation := &model.AssetRepresentation{ID: "representation", AssetVersionID: version.ID, Role: "primary"}
		record := &model.OfficialAssetImport{ID: "import", Scope: model.OfficialAssetImportScopeLibrary, OwnerID: "user", OfficialAssetID: "official", AssetID: asset.ID}
		results <- repo.CreateImportedLibraryAsset(asset, version, representation, record)
	}()
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	require.Equal(t, 1, successes)
	use, err := repo.OfficialAssetUseForUser("user", "official")
	require.NoError(t, err)
	record, err := repo.ImportRecord(model.OfficialAssetImportScopeLibrary, "user", "official")
	require.NoError(t, err)
	require.Equal(t, use.AssetID, record.AssetID)
	var count int64
	require.NoError(t, db.Model(&model.Asset{}).Where("user_id = ?", "user").Count(&count).Error)
	require.EqualValues(t, 1, count)
}
