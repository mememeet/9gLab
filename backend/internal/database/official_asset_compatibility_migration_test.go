package database

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type legacyOfficialAssetForCompatibility struct {
	ID        string `gorm:"primaryKey;size:36"`
	Title     string
	Kind      string
	Category  model.AssetCategory
	Status    string
	Source    string
	License   string
	UpdatedAt time.Time
}

func (legacyOfficialAssetForCompatibility) TableName() string { return "official_assets" }

func TestOfficialAssetCompatibilityPreservesReleasedCatalog(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:official-asset-compatibility?mode=memory&cache=shared"})
	require.NoError(t, err)
	verifyOfficialAssetCompatibility(t, db)
}

func TestPostgresOfficialAssetCompatibilityPreservesReleasedCatalog(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	require.NoError(t, err)
	baseSQL, err := base.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := fmt.Sprintf("official_asset_compat_%d", time.Now().UnixNano())
	require.NoError(t, base.Exec(`CREATE SCHEMA "`+schema+`"`).Error)
	t.Cleanup(func() { require.NoError(t, base.Exec(`DROP SCHEMA "`+schema+`" CASCADE`).Error) })
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	require.NoError(t, err)
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	verifyOfficialAssetCompatibility(t, db)
}

func verifyOfficialAssetCompatibility(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&legacyOfficialAssetForCompatibility{}, &model.OfficialAssetMedia{}, &model.UserOfficialAssetUse{}))
	updatedAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	require.NoError(t, db.Create(&legacyOfficialAssetForCompatibility{ID: "asset", Title: "旧素材", Kind: "image", Status: "published", Source: "原来源", License: "原授权", UpdatedAt: updatedAt}).Error)
	require.NoError(t, db.Create(&model.OfficialAssetMedia{ID: "media", OfficialAssetID: "asset", ResourceID: "resource", Role: "primary"}).Error)
	require.NoError(t, db.Create(&model.UserOfficialAssetUse{ID: "use", UserID: "user", OfficialAssetID: "asset", AssetID: "copy"}).Error)

	require.NoError(t, db.Transaction(migrateOfficialAssetCompatibility))
	var asset model.OfficialAsset
	require.NoError(t, db.First(&asset, "id = ?", "asset").Error)
	require.Equal(t, "旧素材", asset.Title)
	require.Equal(t, "image", asset.Kind)
	require.Equal(t, "image", asset.MediaType)
	require.Equal(t, "resource", asset.ResourceID)
	require.Equal(t, "原来源", asset.SourceName)
	require.Equal(t, "原授权", asset.LicenseNote)
	require.True(t, asset.UpdatedAt.Equal(updatedAt))
	var use model.UserOfficialAssetUse
	require.NoError(t, db.First(&use, "id = ?", "use").Error)
	require.Equal(t, "copy", use.AssetID)
	var imported model.OfficialAssetImport
	require.NoError(t, db.Where("scope = ? AND owner_id = ? AND official_asset_id = ?", model.OfficialAssetImportScopeLibrary, "user", "asset").First(&imported).Error)
	require.Equal(t, "copy", imported.AssetID)

	require.NoError(t, db.Model(&model.OfficialAsset{}).Where("id = ?", "asset").UpdateColumns(map[string]any{"source_name": "新来源", "resource_id": "new-resource"}).Error)
	require.NoError(t, db.Transaction(migrateOfficialAssetCompatibility))
	require.NoError(t, db.First(&asset, "id = ?", "asset").Error)
	require.Equal(t, "新来源", asset.SourceName)
	require.Equal(t, "new-resource", asset.ResourceID)
	var count int64
	require.NoError(t, db.Model(&model.OfficialAssetImport{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestOfficialAssetCompatibilityRejectsConflictingImportRecords(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:official-asset-compatibility-conflict?mode=memory&cache=shared"})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&legacyOfficialAssetForCompatibility{}, &model.OfficialAssetMedia{}, &model.UserOfficialAssetUse{}, &model.OfficialAssetImport{}))
	require.NoError(t, db.Create(&legacyOfficialAssetForCompatibility{ID: "asset", Kind: "image", Status: "published"}).Error)
	require.NoError(t, db.Create(&model.UserOfficialAssetUse{ID: "use", UserID: "user", OfficialAssetID: "asset", AssetID: "old-copy"}).Error)
	require.NoError(t, db.Create(&model.OfficialAssetImport{ID: "import", Scope: model.OfficialAssetImportScopeLibrary, OwnerID: "user", OfficialAssetID: "asset", AssetID: "different-copy"}).Error)
	require.ErrorContains(t, db.Transaction(migrateOfficialAssetCompatibility), "存在不同的导入记录")
	var use model.UserOfficialAssetUse
	require.NoError(t, db.First(&use, "id = ?", "use").Error)
	require.Equal(t, "old-copy", use.AssetID)
	var imported model.OfficialAssetImport
	require.NoError(t, db.First(&imported, "id = ?", "import").Error)
	require.Equal(t, "different-copy", imported.AssetID)
}
