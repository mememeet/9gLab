package database_test

import (
	"testing"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegacyUserSchemaUpgradeRestoresLogin(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.MigrateSchema(db))
	hash, err := auth.HashPassword("fixture-password")
	require.NoError(t, err)
	user := model.User{ID: "legacy-user", Username: "legacy-admin", Email: "fixture@example.invalid", DisplayName: "Existing Admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive, PasswordHash: hash}
	require.NoError(t, db.Create(&user).Error)
	// Reproduce the deployed v38 schema: migration records are current, but
	// users created before identity verification have none of the new columns.
	for _, column := range []string{"phone", "email_verified_at", "phone_verified_at"} {
		require.NoError(t, db.Migrator().DropColumn(&model.User{}, column))
	}
	require.NoError(t, db.Exec("DELETE FROM schema_migrations WHERE version = ?", 39).Error)
	svc := auth.New(repository.New(db), nil, nil)
	request := auth.LoginRequest{Username: user.Username, Password: "fixture-password"}
	_, err = svc.Login(request)
	require.Error(t, err, "legacy schema must reproduce the failed login write")
	require.NoError(t, database.MigrateSchema(db))
	require.NoError(t, database.MigrateSchema(db), "upgrade must be idempotent")
	status, err := database.ReadSchemaStatus(db)
	require.NoError(t, err)
	assert.True(t, status.Ready)
	for _, column := range []string{"phone", "email_verified_at", "phone_verified_at"} {
		assert.True(t, db.Migrator().HasColumn(&model.User{}, column), column)
	}
	result, err := svc.Login(request)
	require.NoError(t, err)
	require.NotEmpty(t, result.Session)
	current, err := svc.CurrentUser(result.Session)
	require.NoError(t, err)
	assert.Equal(t, user.ID, current.ID)
	assert.Equal(t, user.Email, current.Email)
	assert.Equal(t, user.DisplayName, current.DisplayName)
	assert.Equal(t, user.Role, current.Role)
	assert.Equal(t, hash, current.PasswordHash)
	assert.NotNil(t, current.LastLoginAt)
	assert.Empty(t, current.Phone)
	assert.Nil(t, current.EmailVerifiedAt)
	assert.Nil(t, current.PhoneVerifiedAt)
	_, err = svc.Login(auth.LoginRequest{Username: user.Username, Password: "wrong-password"})
	var authErr *auth.AuthError
	require.ErrorAs(t, err, &authErr)
	assert.Equal(t, 401, authErr.Status)
}
