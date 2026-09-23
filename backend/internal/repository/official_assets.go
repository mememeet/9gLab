package repository

import (
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OfficialAssetPageFilter struct {
	Keyword      string
	Kind         string
	Category     string
	Status       string
	FavoriteOnly bool
	UserID       string
	Limit        int
	Offset       int
}

func (r *Repository) OfficialAssetPage(filter OfficialAssetPageFilter) ([]model.OfficialAsset, int64, error) {
	query := r.db.Model(&model.OfficialAsset{})
	if filter.FavoriteOnly {
		query = query.Joins("JOIN user_official_asset_favorites ON user_official_asset_favorites.official_asset_id = official_assets.id AND user_official_asset_favorites.user_id = ?", filter.UserID)
	}
	if value := strings.TrimSpace(filter.Status); value != "" {
		query = query.Where("official_assets.status = ?", value)
	}
	if value := strings.TrimSpace(filter.Kind); value != "" {
		query = query.Where("official_assets.kind = ?", value)
	}
	if value := strings.TrimSpace(filter.Category); value != "" {
		query = query.Where("official_assets.category = ?", value)
	}
	if value := strings.ToLower(strings.TrimSpace(filter.Keyword)); value != "" {
		pattern := "%" + value + "%"
		query = query.Where("LOWER(official_assets.title) LIKE ? OR LOWER(official_assets.description) LIKE ? OR LOWER(official_assets.tags_json) LIKE ? OR LOWER(official_assets.source) LIKE ?", pattern, pattern, pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var assets []model.OfficialAsset
	err := query.Preload("Media", func(db *gorm.DB) *gorm.DB { return db.Order("position ASC, created_at ASC") }).
		Order("official_assets.sort_order DESC, official_assets.updated_at DESC, official_assets.id DESC").
		Offset(filter.Offset).Limit(filter.Limit).Find(&assets).Error
	return assets, total, err
}

func (r *Repository) OfficialAsset(id string) (*model.OfficialAsset, error) {
	var asset model.OfficialAsset
	if err := r.db.Preload("Media", func(db *gorm.DB) *gorm.DB { return db.Order("position ASC, created_at ASC") }).First(&asset, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) CreateOfficialAsset(asset *model.OfficialAsset, media []model.OfficialAssetMedia) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		if len(media) == 0 {
			return nil
		}
		return tx.Create(&media).Error
	})
}

func (r *Repository) UpdateOfficialAsset(asset *model.OfficialAsset) error {
	result := r.db.Model(&model.OfficialAsset{}).Where("id = ?", asset.ID).Updates(map[string]any{
		"title": asset.Title, "kind": asset.Kind, "category": asset.Category, "status": asset.Status,
		"description": asset.Description, "prompt": asset.Prompt, "tags_json": asset.TagsJSON,
		"source": asset.Source, "license": asset.License, "ai_generated": asset.AIGenerated,
		"sort_order": asset.SortOrder, "updated_at": asset.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) ReplaceOfficialAssetMedia(assetID string, media []model.OfficialAssetMedia) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("official_asset_id = ?", assetID).Delete(&model.OfficialAssetMedia{}).Error; err != nil {
			return err
		}
		if len(media) == 0 {
			return nil
		}
		return tx.Create(&media).Error
	})
}

func (r *Repository) OfficialAssetFavoriteIDs(userID string, assetIDs []string) ([]string, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	var ids []string
	err := r.db.Model(&model.UserOfficialAssetFavorite{}).Where("user_id = ? AND official_asset_id IN ?", userID, assetIDs).Pluck("official_asset_id", &ids).Error
	return ids, err
}

func (r *Repository) SetOfficialAssetFavorite(userID string, assetID string, favorite bool) error {
	if !favorite {
		return r.db.Delete(&model.UserOfficialAssetFavorite{}, "user_id = ? AND official_asset_id = ?", userID, assetID).Error
	}
	entry := model.UserOfficialAssetFavorite{UserID: userID, OfficialAssetID: assetID}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&entry).Error
}

func (r *Repository) OfficialAssetUseForUser(userID string, assetID string) (*model.UserOfficialAssetUse, error) {
	var use model.UserOfficialAssetUse
	if err := r.db.First(&use, "user_id = ? AND official_asset_id = ?", userID, assetID).Error; err != nil {
		return nil, err
	}
	return &use, nil
}

func (r *Repository) OfficialAssetUsedIDs(userID string, assetIDs []string) ([]string, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	var ids []string
	err := r.db.Model(&model.UserOfficialAssetUse{}).Where("user_id = ? AND official_asset_id IN ?", userID, assetIDs).Pluck("official_asset_id", &ids).Error
	return ids, err
}

func (r *Repository) CreateOfficialAssetMaterialization(asset *model.Asset, use *model.UserOfficialAssetUse) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		return tx.Create(use).Error
	})
}

func (r *Repository) OfficialAssetUseCounts(assetIDs []string) (map[string]int64, error) {
	result := make(map[string]int64, len(assetIDs))
	if len(assetIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		OfficialAssetID string
		Count           int64
	}
	err := r.db.Model(&model.UserOfficialAssetUse{}).
		Select("official_asset_id, COUNT(*) AS count").Where("official_asset_id IN ?", assetIDs).
		Group("official_asset_id").Scan(&rows).Error
	for _, row := range rows {
		result[row.OfficialAssetID] = row.Count
	}
	return result, err
}

func (r *Repository) OfficialAssetFavoriteCounts(assetIDs []string) (map[string]int64, error) {
	result := make(map[string]int64, len(assetIDs))
	if len(assetIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		OfficialAssetID string
		Count           int64
	}
	err := r.db.Model(&model.UserOfficialAssetFavorite{}).
		Select("official_asset_id, COUNT(*) AS count").Where("official_asset_id IN ?", assetIDs).
		Group("official_asset_id").Scan(&rows).Error
	for _, row := range rows {
		result[row.OfficialAssetID] = row.Count
	}
	return result, err
}
