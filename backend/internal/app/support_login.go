package app

import (
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

const SupportAdminCookieName = auth.SupportAdminCookieName
const SupportSessionIDPrefix = auth.SupportSessionIDPrefix

type SupportSessionInfo = auth.SupportSessionInfo
type SupportLoginResult = auth.SupportLoginResult

func (s *Service) CurrentSession(cookie string) (*model.User, *SupportSessionInfo, error) {
	return s.authDomain().CurrentSession(cookie)
}

func (s *Service) StartSupportLogin(cookie, targetID, reason string) (*SupportLoginResult, error) {
	return s.authDomain().StartSupportLogin(cookie, targetID, reason)
}

func (s *Service) StopSupportLogin(adminCookie string) (*AuthSessionResult, error) {
	return s.authDomain().StopSupportLogin(adminCookie)
}

func (s *Service) AuditSupportRequest(info *SupportSessionInfo, method, route, requestID string) error {
	return s.appendAdminAudit(&model.User{ID: info.AdminUserID}, "support_login.request", "user", info.TargetUserID,
		"临时代登写操作："+method+" "+route, map[string]string{"supportSessionId": info.ID, "method": method, "route": route, "requestId": requestID})
}
