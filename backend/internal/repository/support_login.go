package repository

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

var ErrSupportSessionActive = errors.New("当前管理员已有未结束的临时代登")

func (r *Repository) CreateSupportSession(admin *model.User, parent *model.AuthSession, target *model.User, session *model.AuthSession, event *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockProfileUser(tx, admin.ID); err != nil {
			return err
		}
		var users []model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", []string{admin.ID, target.ID}).Order("id").Find(&users).Error; err != nil {
			return err
		}
		if len(users) != 2 {
			return ErrProfileAuthorization
		}
		for _, user := range users {
			if user.Status != model.UserStatusActive || (user.ID == admin.ID && user.Role != model.UserRoleAdmin) || (user.ID == target.ID && user.Role != model.UserRoleUser) {
				return ErrProfileAuthorization
			}
		}
		var stored model.AuthSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&stored, "id = ?", parent.ID).Error; err != nil {
			return err
		}
		if stored.UserID != admin.ID || stored.TokenHash != parent.TokenHash || stored.SupportParentSessionID != "" || !stored.ExpiresAt.After(time.Now()) || session.UserID != target.ID || session.SupportParentSessionID != stored.ID || session.SupportAdminUserID != admin.ID || session.ExpiresAt.After(stored.ExpiresAt) {
			return ErrProfileAuthorization
		}
		var delegated []model.AuthSession
		if err := tx.Select("expires_at").Where("support_parent_session_id = ?", parent.ID).Find(&delegated).Error; err != nil {
			return err
		}
		for _, active := range delegated {
			if active.ExpiresAt.After(time.Now()) {
				return ErrSupportSessionActive
			}
		}
		if err := tx.Create(session).Error; err != nil {
			return err
		}
		return tx.Create(event).Error
	})
}

func (r *Repository) RevokeSupportSession(sessionID, tokenHash string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var session model.AuthSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ?", sessionID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if session.SupportParentSessionID == "" || session.TokenHash != tokenHash {
			return nil
		}
		removed := tx.Where("id = ? AND token_hash = ?", sessionID, tokenHash).Delete(&model.AuthSession{})
		if removed.Error != nil || removed.RowsAffected == 0 {
			return removed.Error
		}
		metadata, err := json.Marshal(map[string]string{"supportSessionId": session.ID})
		if err != nil {
			return err
		}
		return tx.Create(&model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: session.SupportAdminUserID, Action: "support_login.stop", TargetType: "user", TargetID: session.UserID, Summary: "退出临时代登", MetadataJSON: string(metadata), CreatedAt: time.Now().UTC()}).Error
	})
}

func (r *Repository) EndSupportSessions(admin *model.User, parent *model.AuthSession) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockProfileUser(tx, admin.ID); err != nil {
			return err
		}
		if err := profileAuthorization(tx, admin, parent, time.Now(), false); err != nil {
			return err
		}
		var current model.User
		if err := tx.First(&current, "id = ?", admin.ID).Error; err != nil {
			return err
		}
		if current.Role != model.UserRoleAdmin {
			return ErrProfileAuthorization
		}
		var sessions []model.AuthSession
		if err := tx.Where("support_parent_session_id = ? AND support_admin_user_id = ?", parent.ID, admin.ID).Find(&sessions).Error; err != nil {
			return err
		}
		for _, session := range sessions {
			metadata, err := json.Marshal(map[string]string{"supportSessionId": session.ID})
			if err != nil {
				return err
			}
			event := model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: admin.ID, Action: "support_login.stop", TargetType: "user", TargetID: session.UserID, Summary: "结束临时代登排查", MetadataJSON: string(metadata), CreatedAt: time.Now().UTC()}
			if err := tx.Create(&event).Error; err != nil {
				return err
			}
		}
		return tx.Where("support_parent_session_id = ? AND support_admin_user_id = ?", parent.ID, admin.ID).Delete(&model.AuthSession{}).Error
	})
}
