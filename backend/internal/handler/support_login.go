package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerSupportLoginRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.Use(SupportSessionMiddleware(svc))
	r.POST("/admin/users/:id/support-login", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "support-login:"+user.ID, 10, 15*time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Reason string `json:"reason"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("请填写排查原因"))
			return
		}
		result, err := svc.StartSupportLogin(sessionCookie(c), c.Param("id"), req.Reason)
		if err != nil {
			failService(c, err)
			return
		}
		// The admin credential stays HttpOnly and is never returned in JSON or a URL.
		setSupportAdminCookie(c, sessionCookie(c), 0)
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"user": result.User, "supportSession": result.SupportSession})
	})
	r.POST("/auth/support-login/stop", func(c *gin.Context) {
		backup, _ := c.Cookie(service.SupportAdminCookieName)
		result, err := svc.StopSupportLogin(backup)
		if err != nil {
			var authErr *service.AppError
			if errors.As(err, &authErr) && (authErr.Status == http.StatusUnauthorized || authErr.Status == http.StatusForbidden) {
				clearSessionCookie(c)
				setSupportAdminCookie(c, "", -1)
			}
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		setSupportAdminCookie(c, "", -1)
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"user": result.User})
	})
}

// SupportSessionMiddleware also covers public auth endpoints and the short model proxy.
func SupportSessionMiddleware(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		backup, _ := c.Cookie(service.SupportAdminCookieName)
		if backup == "" && !strings.HasPrefix(sessionCookie(c), service.SupportSessionIDPrefix) {
			return
		}
		switch c.FullPath() {
		case "/api/auth/session", "/api/auth/support-login/stop", "/api/auth/logout":
			return
		}
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		if value, exists := c.Get("supportSession"); exists {
			info := value.(*service.SupportSessionInfo)
			ctx, cancel := context.WithDeadline(c.Request.Context(), info.ExpiresAt)
			defer cancel()
			c.Request = c.Request.WithContext(ctx)
			c.Next()
		}
	}
}

func authorizeRequestIdentity(c *gin.Context, svc *service.Service, user *model.User, support *service.SupportSessionInfo) error {
	if c.FullPath() == "/api/auth/session" {
		return nil
	}
	expected := strings.TrimSpace(c.GetHeader("X-Canvas-User-ID"))
	if expected != "" && expected != user.ID {
		return &service.AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: "session_changed", Message: "登录身份已切换，请刷新页面后重试"}
	}
	if support == nil {
		return nil
	}
	write := c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions
	path := strings.TrimPrefix(c.Request.URL.Path, "/api")
	if strings.HasPrefix(path, "/admin/") || path == "/channels/system" ||
		(strings.HasPrefix(path, "/auth/") && !(!write && strings.HasPrefix(path, "/auth/profile/avatar/"))) ||
		strings.HasPrefix(path, "/payments/") || (write && strings.HasPrefix(path, "/wallet")) {
		return service.Forbidden("临时代登仅用于创作排查，不能进行账号、安全、充值或管理操作")
	}
	if !write {
		return nil
	}
	if expected == "" {
		return &service.AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: "session_changed", Message: "请刷新页面后再进行代登操作"}
	}
	route := c.FullPath()
	if route == "" {
		route = "/api/:channel/*path"
	}
	return svc.AuditSupportRequest(support, c.Request.Method, route, RequestID(c))
}

func setSupportAdminCookie(c *gin.Context, value string, maxAge int) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{Name: service.SupportAdminCookieName, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure})
}
