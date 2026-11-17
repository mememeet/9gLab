package auth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestSupportLogoutRejectsAnotherExpectedUser(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	require.NoError(t, db.AutoMigrate(&model.AdminAuditEvent{}))
	session := model.AuthSession{ID: "sup-test", UserID: "target", TokenHash: HashToken("token"), SupportParentSessionID: "parent", SupportAdminUserID: "admin", ExpiresAt: time.Now().Add(time.Hour)}
	require.NoError(t, db.Create(&session).Error)
	require.Error(t, svc.LogoutForExpectedUser("sup-test.token", "other"))
	var existing model.AuthSession
	require.NoError(t, db.First(&existing, "id = ?", session.ID).Error)
	require.NoError(t, svc.LogoutForExpectedUser("sup-test.token", "target"))
	var count int64
	require.NoError(t, db.Model(&model.AuthSession{}).Where("id = ?", session.ID).Count(&count).Error)
	require.Zero(t, count)
}

func TestInvalidSessionTokenDoesNotDeleteValidSession(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	session := model.AuthSession{ID: "session", UserID: "user", TokenHash: HashToken("token"), ExpiresAt: time.Now().Add(time.Hour)}
	require.NoError(t, db.Create(&session).Error)
	_, _, err := svc.CurrentSession("session.invalid-token")
	require.Error(t, err)
	var count int64
	require.NoError(t, db.Model(&model.AuthSession{}).Where("id = ?", session.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
}
