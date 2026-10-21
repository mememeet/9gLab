package auth

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestSupportLoginPostgres(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	db, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { require.NoError(t, tx.Rollback().Error) })
	require.NoError(t, tx.Exec("CREATE SCHEMA support_login_test").Error)
	require.NoError(t, tx.Exec("SET LOCAL search_path TO support_login_test").Error)
	require.NoError(t, database.MigrateSchema(tx))
	require.NoError(t, tx.Exec("DELETE FROM schema_migrations WHERE version = 59").Error)
	for _, field := range []string{"SupportAdminUserID", "SupportParentSessionID", "SupportReason"} {
		require.NoError(t, tx.Migrator().DropColumn(&model.AuthSession{}, field))
	}
	now := time.Now().UTC()
	admin := model.User{ID: "support-admin", Username: "support-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	target := model.User{ID: "support-target", Username: "support-target", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: "preserved-hash"}
	require.NoError(t, tx.Create(&[]model.User{admin, target}).Error)
	parent := model.AuthSession{ID: "admin-session", UserID: admin.ID, TokenHash: HashToken("admin-token"), ExpiresAt: now.Add(time.Hour)}
	require.NoError(t, tx.Select("ID", "UserID", "TokenHash", "ExpiresAt", "CreatedAt", "UpdatedAt").Create(&parent).Error)
	require.NoError(t, database.MigrateSchema(tx))
	require.NoError(t, database.MigrateSchema(tx))
	svc := New(repository.New(tx), nil, nil)
	result, err := svc.StartSupportLogin("admin-session.admin-token", target.ID, "验证 PostgreSQL 代登事务")
	require.NoError(t, err)
	user, info, err := svc.CurrentSession(result.Session)
	require.NoError(t, err)
	assert.Equal(t, target.ID, user.ID)
	assert.Equal(t, admin.ID, info.AdminUserID)
	_, err = svc.StartSupportLogin("admin-session.admin-token", target.ID, "重复提交")
	require.Error(t, err)
	restored, err := svc.StopSupportLogin("admin-session.admin-token")
	require.NoError(t, err)
	assert.Equal(t, admin.ID, restored.User.ID)
	_, err = svc.CurrentUser(result.Session)
	require.Error(t, err)
	var events []model.AdminAuditEvent
	require.NoError(t, tx.Order("created_at").Find(&events).Error)
	require.Len(t, events, 2)
	assert.Equal(t, "support_login.start", events[0].Action)
	assert.Equal(t, "support_login.stop", events[1].Action)
	var saved model.User
	require.NoError(t, tx.First(&saved, "id = ?", target.ID).Error)
	assert.Equal(t, target.PasswordHash, saved.PasswordHash)
}
