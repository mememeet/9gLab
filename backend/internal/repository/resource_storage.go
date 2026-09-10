package repository

import "infinite-canvas/backend/internal/model"

// PromoteLocalResourceStorage cannot resurrect a deleted resource or overwrite
// another worker's completed migration.
func (r *Repository) PromoteLocalResourceStorage(current, next *model.Resource) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("id = ? AND user_id = ? AND provider = ? AND object_key = ? AND status = ?", current.ID, current.UserID, "local", current.ObjectKey, model.ResourceStatusReady).
		Updates(map[string]any{
			"provider": next.Provider, "endpoint": next.Endpoint, "bucket": next.Bucket,
			"storage_setting_id": next.StorageSettingID, "object_key": next.ObjectKey,
			"e_tag": next.ETag, "updated_at": next.UpdatedAt,
		})
	return result.RowsAffected == 1, result.Error
}
