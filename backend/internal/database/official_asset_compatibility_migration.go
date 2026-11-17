package database

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// migrateOfficialAssetCompatibility keeps the released multi-media catalog as
// the source of truth while supplying the upstream single-resource projection.
func migrateOfficialAssetCompatibility(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.OfficialAsset{}, &model.OfficialAssetMedia{}, &model.UserOfficialAssetUse{}, &model.OfficialAssetImport{}); err != nil {
		return fmt.Errorf("扩展官方素材字段：%w", err)
	}
	var assets []model.OfficialAsset
	if err := tx.Order("id").FindInBatches(&assets, 200, func(_ *gorm.DB, _ int) error {
		for _, asset := range assets {
			updates := map[string]any{}
			if strings.TrimSpace(asset.MediaType) == "" && strings.TrimSpace(asset.Kind) != "" {
				updates["media_type"] = asset.Kind
			}
			if strings.TrimSpace(asset.SourceName) == "" && strings.TrimSpace(asset.Source) != "" {
				updates["source_name"] = asset.Source
			}
			if strings.TrimSpace(asset.LicenseNote) == "" && strings.TrimSpace(asset.License) != "" {
				updates["license_note"] = asset.License
			}
			if strings.TrimSpace(asset.ResourceID) == "" {
				var media model.OfficialAssetMedia
				result := tx.Session(&gorm.Session{NewDB: true}).Where("official_asset_id = ? AND role = ?", asset.ID, "primary").Order("position asc").Order("id asc").Limit(1).Find(&media)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					result = tx.Session(&gorm.Session{NewDB: true}).Where("official_asset_id = ?", asset.ID).Order("position asc").Order("id asc").Limit(1).Find(&media)
					if result.Error != nil {
						return result.Error
					}
				}
				if media.ResourceID != "" {
					updates["resource_id"] = media.ResourceID
				}
			}
			if len(updates) > 0 {
				if err := tx.Session(&gorm.Session{NewDB: true}).Model(&model.OfficialAsset{}).Where("id = ?", asset.ID).UpdateColumns(updates).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var uses []model.UserOfficialAssetUse
	return tx.Order("id").FindInBatches(&uses, 200, func(_ *gorm.DB, _ int) error {
		for _, use := range uses {
			var existing model.OfficialAssetImport
			err := tx.Session(&gorm.Session{NewDB: true}).Where("scope = ? AND owner_id = ? AND official_asset_id = ?", model.OfficialAssetImportScopeLibrary, use.UserID, use.OfficialAssetID).First(&existing).Error
			if err == nil {
				if existing.AssetID != use.AssetID {
					return fmt.Errorf("官方素材 %s 的用户 %s 存在不同的导入记录", use.OfficialAssetID, use.UserID)
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			imported := model.OfficialAssetImport{ID: kernel.NewID(), Scope: model.OfficialAssetImportScopeLibrary, OwnerID: use.UserID, OfficialAssetID: use.OfficialAssetID, AssetID: use.AssetID, CreatedAt: use.CreatedAt}
			if err := tx.Session(&gorm.Session{NewDB: true}).Create(&imported).Error; err != nil {
				return err
			}
		}
		return nil
	}).Error
}
