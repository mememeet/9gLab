package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) GatewayAssetBindingForResource(userID, resourceID, gatewayOrigin string) (*model.GatewayAssetBinding, error) {
	var binding model.GatewayAssetBinding
	err := r.db.First(&binding, "user_id = ? AND resource_id = ? AND gateway_origin = ?", userID, resourceID, gatewayOrigin).Error
	return &binding, err
}

// ClaimGatewayAssetBinding gives one worker ownership of an upload while
// preserving a ready binding across API-key rotations. A crashed syncing claim
// becomes reclaimable after staleBefore.
func (r *Repository) ClaimGatewayAssetBinding(userID, resourceID, gatewayOrigin, bindingID string, staleBefore time.Time) (*model.GatewayAssetBinding, bool, error) {
	created := &model.GatewayAssetBinding{
		ID: bindingID, UserID: userID, ResourceID: resourceID, GatewayOrigin: gatewayOrigin,
		Status: model.GatewayAssetBindingSyncing, Attempts: 1,
	}
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "resource_id"}, {Name: "gateway_origin"}},
		DoNothing: true,
	}).Create(created)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return created, true, nil
	}

	binding, err := r.GatewayAssetBindingForResource(userID, resourceID, gatewayOrigin)
	if err != nil {
		return nil, false, err
	}
	if binding.Status == model.GatewayAssetBindingReady && binding.GatewayAssetID != "" {
		return binding, false, nil
	}
	claim := r.db.Model(&model.GatewayAssetBinding{}).
		Where("id = ? AND user_id = ? AND (status = ? OR (status = ? AND updated_at <= ?))",
			binding.ID, userID, model.GatewayAssetBindingFailed, model.GatewayAssetBindingSyncing, staleBefore).
		Updates(map[string]any{
			"status": model.GatewayAssetBindingSyncing, "gateway_asset_id": "", "last_error": "",
			"attempts": gorm.Expr("attempts + ?", 1), "updated_at": time.Now(),
		})
	if claim.Error != nil {
		return nil, false, claim.Error
	}
	if claim.RowsAffected == 1 {
		binding.Status = model.GatewayAssetBindingSyncing
		binding.GatewayAssetID = ""
		binding.LastError = ""
		binding.Attempts++
		binding.UpdatedAt = time.Now()
		return binding, true, nil
	}
	return binding, false, nil
}

func (r *Repository) CompleteGatewayAssetBinding(userID, bindingID, gatewayAssetID string) error {
	result := r.db.Model(&model.GatewayAssetBinding{}).
		Where("id = ? AND user_id = ? AND status = ?", bindingID, userID, model.GatewayAssetBindingSyncing).
		Updates(map[string]any{"status": model.GatewayAssetBindingReady, "gateway_asset_id": gatewayAssetID, "last_error": "", "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("gateway asset binding state changed")
	}
	return nil
}

func (r *Repository) FailGatewayAssetBinding(userID, bindingID, message string) error {
	return r.db.Model(&model.GatewayAssetBinding{}).
		Where("id = ? AND user_id = ? AND status = ?", bindingID, userID, model.GatewayAssetBindingSyncing).
		Updates(map[string]any{"status": model.GatewayAssetBindingFailed, "last_error": message, "updated_at": time.Now()}).Error
}
