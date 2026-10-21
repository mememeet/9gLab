package database

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestSupportLoginMigrationPreservesExistingSessions(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "support-migration.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, MigrateSchema(db))
	require.NoError(t, db.Exec("DELETE FROM schema_migrations WHERE version = 59").Error)
	for _, column := range []string{"SupportAdminUserID", "SupportParentSessionID", "SupportReason"} {
		require.NoError(t, db.Migrator().DropColumn(&model.AuthSession{}, column))
	}
	session := model.AuthSession{ID: "existing-session", UserID: "existing-user", TokenHash: "existing-hash", ExpiresAt: time.Now().UTC().Add(time.Hour)}
	require.NoError(t, db.Table("auth_sessions").Select("ID", "UserID", "TokenHash", "ExpiresAt", "CreatedAt", "UpdatedAt").Create(&session).Error)
	require.NoError(t, MigrateSchema(db))
	require.NoError(t, MigrateSchema(db))
	var saved model.AuthSession
	require.NoError(t, db.First(&saved, "id = ?", session.ID).Error)
	assert.Equal(t, session.UserID, saved.UserID)
	assert.Equal(t, session.TokenHash, saved.TokenHash)
	assert.True(t, session.ExpiresAt.Equal(saved.ExpiresAt))
	assert.Empty(t, saved.SupportParentSessionID)
	status, err := ReadSchemaStatus(db)
	require.NoError(t, err)
	assert.True(t, status.Ready)
	assert.Equal(t, CurrentSchemaVersion, status.Current)
}
