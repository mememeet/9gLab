package database

import (
	"testing"

	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestDramaMigrationRefusesToRewriteLegacyShots(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:drama-preserve?mode=memory&cache=shared"})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, MigrateSchema(db))
	require.NoError(t, db.Exec("ALTER TABLE drama_shots ADD COLUMN video_resource_id text").Error)
	require.NoError(t, db.Create(&model.DramaShot{ID: "legacy-shot", ProjectID: "project"}).Error)
	require.NoError(t, db.Exec("UPDATE drama_shots SET video_resource_id = ? WHERE id = ?", "legacy-video", "legacy-shot").Error)

	require.ErrorContains(t, migrateDramaSegmentProduction(db), "拒绝自动迁移")
	var resource string
	require.NoError(t, db.Table("drama_shots").Select("video_resource_id").Where("id = ?", "legacy-shot").Scan(&resource).Error)
	require.Equal(t, "legacy-video", resource)
}
