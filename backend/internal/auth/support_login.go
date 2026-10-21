package auth

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const SupportAdminCookieName = "open_ai_canvas_support_admin"
const SupportSessionIDPrefix = "sup-"
const supportSessionTTL = 15 * time.Minute

type SupportSessionInfo struct {
	ID               string    `json:"id"`
	AdminUserID      string    `json:"adminUserId"`
	AdminDisplayName string    `json:"adminDisplayName"`
	TargetUserID     string    `json:"targetUserId"`
	TargetUsername   string    `json:"targetUsername"`
	TargetName       string    `json:"targetName"`
	Reason           string    `json:"reason"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

type SupportLoginResult struct {
	AuthSessionResult
	SupportSession SupportSessionInfo `json:"supportSession"`
}

func (s *Service) validateSupportSession(session *model.AuthSession, target *model.User) (*SupportSessionInfo, error) {
	parent, err := s.repo.AuthSession(session.SupportParentSessionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.Unauthorized("管理员会话已结束，临时代登已失效")
	}
	if err != nil {
		return nil, err
	}
	if parent.SupportParentSessionID != "" || parent.UserID != session.SupportAdminUserID || !parent.ExpiresAt.After(time.Now()) {
		return nil, kernel.Unauthorized("管理员会话已结束，临时代登已失效")
	}
	admin, err := s.repo.User(parent.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.Unauthorized("管理员会话已结束，临时代登已失效")
	}
	if err != nil {
		return nil, err
	}
	if admin.Status != model.UserStatusActive || admin.Role != model.UserRoleAdmin || target.Role != model.UserRoleUser {
		return nil, kernel.Forbidden("账号权限已变化，临时代登已失效")
	}
	return &SupportSessionInfo{
		ID: session.ID, AdminUserID: admin.ID, AdminDisplayName: admin.DisplayName,
		TargetUserID: target.ID, TargetUsername: target.Username, TargetName: target.DisplayName,
		Reason: session.SupportReason, ExpiresAt: session.ExpiresAt,
	}, nil
}

func (s *Service) StartSupportLogin(cookieValue, targetID, reason string) (*SupportLoginResult, error) {
	admin, existing, err := s.CurrentSession(cookieValue)
	if err != nil {
		return nil, err
	}
	if existing != nil || admin.Role != model.UserRoleAdmin {
		return nil, kernel.Forbidden("只有管理员本人可以开始临时代登")
	}
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) == 0 || len([]rune(reason)) > 500 {
		return nil, kernel.BadAuthRequest("请填写 1-500 字的排查原因")
	}
	target, err := s.repo.User(strings.TrimSpace(targetID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("用户不存在")
	}
	if err != nil {
		return nil, err
	}
	if target.ID == admin.ID || target.Role != model.UserRoleUser || target.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("只能代登已启用的普通用户")
	}
	parentID, _ := parseSessionCookie(cookieValue)
	parent, err := s.repo.AuthSession(parentID)
	if err != nil {
		return nil, err
	}
	publicUser, err := s.PublicAuthUser(target)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	expiresAt := now.Add(supportSessionTTL)
	if parent.ExpiresAt.Before(expiresAt) {
		expiresAt = parent.ExpiresAt
	}
	token := RandomToken()
	session := model.AuthSession{
		ID: SupportSessionIDPrefix + kernel.NewID(), UserID: target.ID, TokenHash: HashToken(token),
		SupportAdminUserID: admin.ID, SupportParentSessionID: parent.ID, SupportReason: reason,
		ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now,
	}
	metadata, err := json.Marshal(map[string]any{"supportSessionId": session.ID, "reason": reason, "expiresAt": expiresAt})
	if err != nil {
		return nil, err
	}
	event := model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: admin.ID, Action: "support_login.start", TargetType: "user", TargetID: target.ID, Summary: "开始临时代登排查", MetadataJSON: string(metadata), CreatedAt: now}
	if err := s.repo.CreateSupportSession(admin, parent, target, &session, &event); err != nil {
		if errors.Is(err, repository.ErrSupportSessionActive) {
			return nil, &kernel.AppError{Status: 409, Code: 409, Reason: kernel.ReasonConflict, Message: "当前已有临时代登，请先结束后再试"}
		}
		if errors.Is(err, repository.ErrProfileAuthorization) {
			return nil, kernel.Forbidden("账号或管理员会话已变化，请重新登录后再试")
		}
		return nil, err
	}
	return &SupportLoginResult{
		AuthSessionResult: AuthSessionResult{User: publicUser, Session: session.ID + "." + token, MaxAgeSecs: int(time.Until(expiresAt).Seconds())},
		SupportSession:    SupportSessionInfo{ID: session.ID, AdminUserID: admin.ID, AdminDisplayName: admin.DisplayName, TargetUserID: target.ID, TargetUsername: target.Username, TargetName: target.DisplayName, Reason: reason, ExpiresAt: expiresAt},
	}, nil
}

func (s *Service) StopSupportLogin(adminCookie string) (*AuthSessionResult, error) {
	admin, support, err := s.CurrentSession(adminCookie)
	if err != nil {
		return nil, err
	}
	if support != nil || admin.Role != model.UserRoleAdmin {
		return nil, kernel.Forbidden("无法恢复管理员身份，请重新登录")
	}
	parentID, _ := parseSessionCookie(adminCookie)
	parent, err := s.repo.AuthSession(parentID)
	if err != nil {
		return nil, err
	}
	publicUser, err := s.PublicAuthUser(admin)
	if err != nil {
		return nil, err
	}
	if err := s.repo.EndSupportSessions(admin, parent); err != nil {
		if errors.Is(err, repository.ErrProfileAuthorization) {
			return nil, kernel.Unauthorized("管理员会话已失效，请重新登录")
		}
		return nil, err
	}
	return &AuthSessionResult{User: publicUser, Session: adminCookie, MaxAgeSecs: int(time.Until(parent.ExpiresAt).Seconds())}, nil
}
