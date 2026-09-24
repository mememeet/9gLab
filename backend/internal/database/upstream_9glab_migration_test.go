package database

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"infinite-canvas/backend/internal/model"
)

// Published 9gLab versions overlap upstream versions. Updating must append
// migrations, never reinterpret the existing ledger or rebuild user content.
func TestUpstreamUpgradePreserves9gLabV26Content(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:9glab-upstream-preservation?mode=memory&cache=shared"})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&schemaMigration{}))
	for _, item := range schemaMigrations {
		if item.version > 26 {
			break
		}
		require.NoError(t, item.apply(db))
		require.NoError(t, db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error)
	}
	var originalLedger []schemaMigration
	require.NoError(t, db.Order("version").Find(&originalLedger).Error)
	savedAt := time.Now().UTC().Truncate(time.Second)
	assets := []model.Asset{
		{ID: "saved", UserID: "owner", Kind: "image", Title: "保存的角色", LibrarySavedAt: &savedAt, PayloadJSON: `{"source":"official-library","imageStorageKey":"resource:media"}`},
		{ID: "generated", UserID: "owner", Kind: "image", Title: "画布技术记录", PayloadJSON: `{"source":"generation-task","imageStorageKey":"resource:generated"}`},
	}
	require.NoError(t, db.Create(&assets).Error)
	official := model.OfficialAsset{ID: "official", Title: "通用角色", Status: model.OfficialAssetStatusPublished, CreatedBy: "admin"}
	require.NoError(t, db.Create(&official).Error)
	media := model.OfficialAssetMedia{ID: "official-media", OfficialAssetID: official.ID, ResourceID: "media"}
	require.NoError(t, db.Create(&media).Error)
	usage := model.UserOfficialAssetUse{ID: "official-use", UserID: "owner", OfficialAssetID: official.ID, AssetID: "saved"}
	require.NoError(t, db.Create(&usage).Error)
	// Remove new tables to emulate the old database, since the baseline model
	// registry contains current models in a fresh test database.
	require.NoError(t, db.Migrator().DropTable(&model.CanvasSnapshotResource{}, &model.CanvasSnapshot{}, &model.CloudAgentResourceLease{}, &model.ToolFavorite{}, &model.Tool{}))
	for range 2 {
		require.NoError(t, MigrateSchema(db))
	}
	require.NoError(t, RequireSchemaVersion(db))
	var ledger []schemaMigration
	require.NoError(t, db.Where("version <= ?", 26).Order("version").Find(&ledger).Error)
	require.Equal(t, originalLedger, ledger)
	var actual []model.Asset
	require.NoError(t, db.Order("id").Find(&actual).Error)
	require.Len(t, actual, 2)
	require.Nil(t, actual[0].LibrarySavedAt)
	require.Equal(t, assets[1].PayloadJSON, actual[0].PayloadJSON)
	require.NotNil(t, actual[1].LibrarySavedAt)
	require.True(t, savedAt.Equal(*actual[1].LibrarySavedAt))
	require.Equal(t, assets[0].PayloadJSON, actual[1].PayloadJSON)
	var actualOfficial model.OfficialAsset
	require.NoError(t, db.First(&actualOfficial, "id = ?", official.ID).Error)
	require.Equal(t, official.Title, actualOfficial.Title)
	require.Equal(t, official.Status, actualOfficial.Status)
	var actualMedia model.OfficialAssetMedia
	require.NoError(t, db.First(&actualMedia, "id = ?", media.ID).Error)
	require.Equal(t, media.ResourceID, actualMedia.ResourceID)
	var actualUse model.UserOfficialAssetUse
	require.NoError(t, db.First(&actualUse, "id = ?", usage.ID).Error)
	require.Equal(t, usage.AssetID, actualUse.AssetID)
	for _, entity := range []any{&model.CanvasSnapshot{}, &model.Tool{}, &model.ToolFavorite{}, &model.CloudAgentResourceLease{}} {
		require.True(t, db.Migrator().HasTable(entity))
	}
}
