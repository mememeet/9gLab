package database

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestPostgresUpgradePreserves9gLabV59(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	require.NoError(t, err)
	baseSQL, err := base.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := fmt.Sprintf("upstream_9glab_%d", time.Now().UnixNano())
	require.NoError(t, base.Exec(`CREATE SCHEMA "`+schema+`"`).Error)
	t.Cleanup(func() { require.NoError(t, base.Exec(`DROP SCHEMA "`+schema+`" CASCADE`).Error) })
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	require.NoError(t, err)
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&schemaMigration{}))
	for _, item := range schemaMigrations {
		if item.version > 59 {
			break
		}
		require.NoError(t, item.apply(db))
		require.NoError(t, db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error)
	}
	var before []schemaMigration
	require.NoError(t, db.Order("version").Find(&before).Error)
	asset := model.Asset{ID: "preserved-asset", UserID: "owner", Kind: "image", Title: "existing asset", PayloadJSON: `{"source":"existing"}`}
	require.NoError(t, db.Create(&asset).Error)
	require.NoError(t, MigrateSchema(db))
	require.NoError(t, MigrateSchema(db))
	var after []schemaMigration
	require.NoError(t, db.Where("version <= ?", 59).Order("version").Find(&after).Error)
	require.Equal(t, before, after)
	var restored model.Asset
	require.NoError(t, db.First(&restored, "id = ?", asset.ID).Error)
	require.Equal(t, asset.Title, restored.Title)
	require.Equal(t, asset.PayloadJSON, restored.PayloadJSON)
	require.NoError(t, RequireSchemaVersion(db))
}
