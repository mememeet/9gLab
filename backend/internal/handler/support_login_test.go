package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

func supportLoginFixture(t *testing.T) (*gin.Engine, *gorm.DB, string) {
	t.Helper()
	router, db, _ := profileHandlerFixture(t)
	now := time.Now().UTC()
	require.NoError(t, db.Create(&model.User{ID: "support-admin", Username: "support-admin", DisplayName: "Support Admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error)
	require.NoError(t, db.Create(&model.AuthSession{ID: "admin-session", UserID: "support-admin", TokenHash: auth.HashToken("admin-token"), ExpiresAt: now.Add(time.Hour)}).Error)
	for _, item := range []struct{ id, userID, title string }{{"user-canvas", "profile-user", "User canvas"}, {"admin-canvas", "support-admin", "Admin canvas"}} {
		payload, err := json.Marshal(map[string]any{"id": item.id, "title": item.title, "nodes": []any{}, "connections": []any{}})
		require.NoError(t, err)
		require.NoError(t, db.Create(&model.CanvasProject{ID: item.id, UserID: item.userID, Title: item.title, Revision: 1, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}).Error)
	}
	api := router.Group("/api")
	RegisterUserDataRoutes(api, runtimeService)
	RegisterPaymentRoutes(api, runtimeService)
	registerAdminUserRoutes(api, runtimeService)
	return router, db, "admin-session.admin-token"
}

func supportRequest(router http.Handler, method, path, body, cookie, backup, expected string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-Proto", "https")
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: cookie})
	}
	if backup != "" {
		req.AddCookie(&http.Cookie{Name: auth.SupportAdminCookieName, Value: backup})
	}
	if expected != "" {
		req.Header.Set("X-Canvas-User-ID", expected)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func startSupportForTest(t *testing.T, router http.Handler, adminCookie string) string {
	t.Helper()
	rec := supportRequest(router, "POST", "/api/admin/users/profile-user/support-login", `{"reason":"排查分镜提示词遗漏"}`, adminCookie, "", "support-admin")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "admin-token")
	for _, cookie := range rec.Result().Cookies() {
		assert.True(t, cookie.HttpOnly)
		assert.True(t, cookie.Secure)
		assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
		if cookie.Name == auth.SupportAdminCookieName {
			assert.Equal(t, adminCookie, cookie.Value)
		}
		if cookie.Name == auth.SessionCookieName {
			assert.Greater(t, cookie.MaxAge, 0)
			assert.LessOrEqual(t, cookie.MaxAge, 15*60)
			return cookie.Value
		}
	}
	t.Fatal("support session cookie missing")
	return ""
}

const supportCanvasPatch = `{"mutationId":"support-title","expectedRevision":1,"operations":[{"type":"set_field","field":"title","value":"排查后的标题","beforeValue":"User canvas"}]}`

func TestSupportLoginHTTPIsolatesUserWritesAndRestoresAdminAfterExpiry(t *testing.T) {
	router, db, adminCookie := supportLoginFixture(t)
	var before model.User
	require.NoError(t, db.First(&before, "id = ?", "profile-user").Error)
	cookie := startSupportForTest(t, router, adminCookie)
	duplicate := supportRequest(router, "POST", "/api/admin/users/profile-user/support-login", `{"reason":"重复排查"}`, adminCookie, "", "support-admin")
	assert.Equal(t, http.StatusConflict, duplicate.Code)
	session := supportRequest(router, "GET", "/api/auth/session", "", cookie, adminCookie, "")
	require.Equal(t, http.StatusOK, session.Code)
	assert.Contains(t, session.Body.String(), `"targetUserId":"profile-user"`)
	assert.Contains(t, session.Body.String(), `"supportRestoreAvailable":true`)
	assert.Equal(t, http.StatusOK, supportRequest(router, "GET", "/api/canvas-projects/user-canvas", "", cookie, adminCookie, "profile-user").Code)
	assert.Equal(t, http.StatusNotFound, supportRequest(router, "GET", "/api/canvas-projects/admin-canvas", "", cookie, adminCookie, "profile-user").Code)
	for _, expected := range []string{"", "support-admin"} {
		assert.Equal(t, http.StatusConflict, supportRequest(router, "PATCH", "/api/canvas-projects/user-canvas/operations", supportCanvasPatch, cookie, adminCookie, expected).Code)
	}
	write := supportRequest(router, "PATCH", "/api/canvas-projects/user-canvas/operations", supportCanvasPatch, cookie, adminCookie, "profile-user")
	require.Equal(t, http.StatusOK, write.Code, write.Body.String())
	var project model.CanvasProject
	require.NoError(t, db.First(&project, "id = ?", "user-canvas").Error)
	assert.Equal(t, "排查后的标题", project.Title)
	var events []model.AdminAuditEvent
	require.NoError(t, db.Where("action = ?", "support_login.request").Find(&events).Error)
	require.Len(t, events, 1)
	assert.Equal(t, "support-admin", events[0].ActorUserID)
	assert.Equal(t, "profile-user", events[0].TargetID)
	assert.Contains(t, events[0].MetadataJSON, "/api/canvas-projects/:id/operations")
	assert.NotContains(t, events[0].MetadataJSON, "排查后的标题")
	assert.NotContains(t, events[0].MetadataJSON, "admin-token")
	require.NoError(t, db.Model(&model.AuthSession{}).Where("support_parent_session_id = ?", "admin-session").Update("expires_at", time.Now().Add(-time.Second)).Error)
	expired := supportRequest(router, "GET", "/api/auth/session", "", cookie, adminCookie, "")
	assert.Contains(t, expired.Body.String(), `"user":null`)
	assert.Contains(t, expired.Body.String(), `"supportRestoreAvailable":true`)
	restored := supportRequest(router, "POST", "/api/auth/support-login/stop", `{}`, cookie, adminCookie, "profile-user")
	require.Equal(t, http.StatusOK, restored.Code, restored.Body.String())
	assert.Contains(t, restored.Body.String(), `"id":"support-admin"`)
	assert.Equal(t, http.StatusUnauthorized, supportRequest(router, "GET", "/api/canvas-projects/user-canvas", "", cookie, "", "profile-user").Code)
	assert.Equal(t, http.StatusOK, supportRequest(router, "GET", "/api/canvas-projects/admin-canvas", "", adminCookie, "", "support-admin").Code)
	assert.Equal(t, http.StatusConflict, supportRequest(router, "PATCH", "/api/canvas-projects/admin-canvas/operations", supportCanvasPatch, adminCookie, "", "profile-user").Code)
	assert.Contains(t, supportRequest(router, "GET", "/api/auth/session", "", "profile-session.fixture-token", "", "").Body.String(), `"id":"profile-user"`)
	var after model.User
	require.NoError(t, db.First(&after, "id = ?", "profile-user").Error)
	assert.Equal(t, before.PasswordHash, after.PasswordHash)
	assert.Equal(t, before.LastLoginAt, after.LastLoginAt)
	var stops int64
	require.NoError(t, db.Model(&model.AdminAuditEvent{}).Where("action = ? AND actor_user_id = ? AND target_id = ?", "support_login.stop", "support-admin", "profile-user").Count(&stops).Error)
	assert.EqualValues(t, 1, stops)
}

func TestSupportLoginLogoutWithoutBackupIsAttributedToAdmin(t *testing.T) {
	router, db, adminCookie := supportLoginFixture(t)
	cookie := startSupportForTest(t, router, adminCookie)
	response := supportRequest(router, "POST", "/api/auth/logout", `{}`, cookie, "", "profile-user")
	require.Equal(t, http.StatusOK, response.Code)
	var events []model.AdminAuditEvent
	require.NoError(t, db.Where("action = ?", "support_login.stop").Find(&events).Error)
	require.Len(t, events, 1)
	assert.Equal(t, "support-admin", events[0].ActorUserID)
	var targetLogouts int64
	require.NoError(t, db.Model(&model.LoginLog{}).Where("user_id = ? AND event = ?", "profile-user", "logout").Count(&targetLogouts).Error)
	assert.Zero(t, targetLogouts)
	assert.Equal(t, http.StatusOK, supportRequest(router, "GET", "/api/canvas-projects/admin-canvas", "", adminCookie, "", "support-admin").Code)
}

func TestSupportLoginRejectsInvalidTargetsAndNestedOrSecurityActions(t *testing.T) {
	router, db, adminCookie := supportLoginFixture(t)
	require.NoError(t, db.Create(&model.User{ID: "disabled-user", Username: "disabled-user", Role: model.UserRoleUser, Status: model.UserStatusDisabled}).Error)
	for _, tc := range []struct {
		cookie, target, reason string
		status                 int
	}{
		{"profile-session.fixture-token", "profile-user", "排查", 403},
		{adminCookie, "support-admin", "排查", 403},
		{adminCookie, "disabled-user", "排查", 403},
		{adminCookie, "missing-user", "排查", 400},
		{adminCookie, "profile-user", " ", 400},
		{adminCookie, "profile-user", strings.Repeat("长", 501), 400},
	} {
		body, err := json.Marshal(map[string]string{"reason": tc.reason})
		require.NoError(t, err)
		assert.Equal(t, tc.status, supportRequest(router, "POST", "/api/admin/users/"+tc.target+"/support-login", string(body), tc.cookie, "", "").Code)
	}
	cookie := startSupportForTest(t, router, adminCookie)
	for _, route := range []struct{ method, path string }{
		{"POST", "/api/admin/users/profile-user/support-login"},
		{"GET", "/api/admin/users"}, {"GET", "/api/auth/profile"},
		{"POST", "/api/auth/profile/password"}, {"POST", "/api/auth/profile/email-code"},
		{"POST", "/api/auth/login"}, {"POST", "/api/auth/register"},
		{"POST", "/api/payments/orders"}, {"GET", "/api/payments/providers"},
	} {
		response := supportRequest(router, route.method, route.path, `{}`, cookie, adminCookie, "profile-user")
		assert.Equal(t, http.StatusForbidden, response.Code, route.path+": "+response.Body.String())
	}
	forgedRestore := supportRequest(router, "POST", "/api/auth/support-login/stop", `{}`, cookie, "profile-session.fixture-token", "profile-user")
	assert.Equal(t, http.StatusForbidden, forgedRestore.Code)
	assert.Equal(t, http.StatusOK, supportRequest(router, "GET", "/api/canvas-projects/user-canvas", "", cookie, adminCookie, "profile-user").Code)
}

func TestSupportLoginStopsWhenParentOrAccountAuthorizationChanges(t *testing.T) {
	for _, change := range []string{"parent_deleted", "parent_expired", "admin_demoted", "admin_disabled", "target_disabled", "target_promoted"} {
		t.Run(change, func(t *testing.T) {
			router, db, adminCookie := supportLoginFixture(t)
			cookie := startSupportForTest(t, router, adminCookie)
			switch change {
			case "parent_deleted":
				require.NoError(t, db.Delete(&model.AuthSession{}, "id = ?", "admin-session").Error)
			case "parent_expired":
				require.NoError(t, db.Model(&model.AuthSession{}).Where("id = ?", "admin-session").Update("expires_at", time.Now().Add(-time.Second)).Error)
			case "admin_demoted":
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", "support-admin").Update("role", model.UserRoleUser).Error)
			case "admin_disabled":
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", "support-admin").Update("status", model.UserStatusDisabled).Error)
			case "target_disabled":
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", "profile-user").Update("status", model.UserStatusDisabled).Error)
			case "target_promoted":
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", "profile-user").Update("role", model.UserRoleAdmin).Error)
			}
			response := supportRequest(router, "PATCH", "/api/canvas-projects/user-canvas/operations", supportCanvasPatch, cookie, "", "profile-user")
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, response.Code)
			var project model.CanvasProject
			require.NoError(t, db.First(&project, "id = ?", "user-canvas").Error)
			assert.Equal(t, "User canvas", project.Title)
		})
	}
}

func TestSupportLoginFailsClosedIfAuditCannotBeStored(t *testing.T) {
	for _, phase := range []string{"start", "write"} {
		t.Run(phase, func(t *testing.T) {
			router, db, adminCookie := supportLoginFixture(t)
			cookie := adminCookie
			if phase == "write" {
				cookie = startSupportForTest(t, router, adminCookie)
			}
			require.NoError(t, db.Migrator().DropTable(&model.AdminAuditEvent{}))
			if phase == "start" {
				response := supportRequest(router, "POST", "/api/admin/users/profile-user/support-login", `{"reason":"排查"}`, cookie, "", "support-admin")
				assert.Equal(t, http.StatusInternalServerError, response.Code)
				var count int64
				require.NoError(t, db.Model(&model.AuthSession{}).Where("support_parent_session_id <> ?", "").Count(&count).Error)
				assert.Zero(t, count)
			} else {
				response := supportRequest(router, "PATCH", "/api/canvas-projects/user-canvas/operations", supportCanvasPatch, cookie, adminCookie, "profile-user")
				assert.Equal(t, http.StatusInternalServerError, response.Code)
				var project model.CanvasProject
				require.NoError(t, db.First(&project, "id = ?", "user-canvas").Error)
				assert.Equal(t, "User canvas", project.Title)
			}
		})
	}
}
