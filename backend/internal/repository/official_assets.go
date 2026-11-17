package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OfficialAssetPageFilter struct {
	MediaType    string
	Tag          string
	Query        string
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
	query := r.db.Model(&model.OfficialAsset{}).Where("official_assets.deleted_at IS NULL")
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
	if err := r.db.Preload("Media", func(db *gorm.DB) *gorm.DB { return db.Order("position ASC, created_at ASC") }).First(&asset, "id = ? AND deleted_at IS NULL", id).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) CreateOfficialAsset(asset *model.OfficialAsset, mediaGroups ...[]model.OfficialAssetMedia) error {
	var media []model.OfficialAssetMedia
	if len(mediaGroups) > 0 {
		media = mediaGroups[0]
	}
	// 上游的单资源素材和 9GLab 的多媒体条目共享同一个目录。
	if len(media) == 0 && asset.ResourceID != "" && asset.MediaType != model.OfficialAssetMediaTypeEntity {
		media = []model.OfficialAssetMedia{{ID: kernel.NewID(), OfficialAssetID: asset.ID, ResourceID: asset.ResourceID, Role: "primary", Position: 0, CreatedAt: asset.CreatedAt}}
	}
	if asset.Kind == "" {
		asset.Kind = asset.MediaType
	}
	if asset.MediaType == "" {
		asset.MediaType = asset.Kind
	}
	if asset.ResourceID == "" && len(media) > 0 {
		asset.ResourceID = media[0].ResourceID
	}
	if asset.SourceName == "" {
		asset.SourceName = asset.Source
	}
	if asset.Source == "" {
		asset.Source = asset.SourceName
	}
	if asset.LicenseNote == "" {
		asset.LicenseNote = asset.License
	}
	if asset.License == "" {
		asset.License = asset.LicenseNote
	}
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
		"title": asset.Title, "kind": asset.Kind, "media_type": asset.Kind, "category": asset.Category, "status": asset.Status,
		"description": asset.Description, "prompt": asset.Prompt, "tags_json": asset.TagsJSON,
		"source": asset.Source, "source_name": asset.Source, "license": asset.License, "license_note": asset.License, "ai_generated": asset.AIGenerated,
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
		resourceID := ""
		if len(media) > 0 {
			resourceID = media[0].ResourceID
		}
		if err := tx.Model(&model.OfficialAsset{}).Where("id = ?", assetID).UpdateColumn("resource_id", resourceID).Error; err != nil {
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
		if err := tx.Create(use).Error; err != nil {
			return err
		}
		return tx.Create(&model.OfficialAssetImport{ID: kernel.NewID(), Scope: model.OfficialAssetImportScopeLibrary, OwnerID: use.UserID, OfficialAssetID: use.OfficialAssetID, AssetID: use.AssetID, CreatedAt: use.CreatedAt}).Error
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

// officialAssetFilteredQuery 给官方素材查询叠加过滤条件。
// 关键词命中 title / description / tags_json；标签用带引号的 LIKE，
// 避免 "cat" 命中 "category" 这类子串误伤；通配符先转义。
func officialAssetFilteredQuery(query *gorm.DB, filter OfficialAssetPageFilter, publishedOnly bool) *gorm.DB {
	if publishedOnly {
		query = query.Where("status = ? AND deleted_at IS NULL", model.OfficialAssetStatusPublished)
	} else {
		query = query.Where("deleted_at IS NULL")
		if value := strings.TrimSpace(filter.Status); value != "" && value != "all" {
			query = query.Where("status = ?", value)
		}
	}
	if value := strings.TrimSpace(filter.MediaType); value != "" {
		query = query.Where("media_type = ?", value)
	}
	if value := strings.TrimSpace(filter.Category); value != "" {
		query = query.Where("category = ?", value)
	}
	if value := strings.TrimSpace(filter.Tag); value != "" {
		pattern := `%"` + escapeLikeValue(value) + `"%`
		query = query.Where("tags_json LIKE ? ESCAPE '\\'", pattern)
	}
	if value := strings.ToLower(strings.TrimSpace(filter.Query)); value != "" {
		pattern := "%" + value + "%"
		query = query.Where("LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags_json) LIKE ?", pattern, pattern, pattern)
	}
	return query
}

// escapeLikeValue 转义 LIKE 模式里的通配符，配合 ESCAPE '\' 使用。
func escapeLikeValue(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// OfficialAssetsPage 返回一页官方素材与总数。排序固定为
// sort_order ASC, updated_at DESC, id DESC（管理端排序调整后立即生效）。
func (r *Repository) OfficialAssetsPage(page int, pageSize int, filter OfficialAssetPageFilter, publishedOnly bool) ([]model.OfficialAsset, int64, error) {
	var assets []model.OfficialAsset
	var total int64
	query := officialAssetFilteredQuery(r.db.Model(&model.OfficialAsset{}), filter, publishedOnly)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("sort_order ASC, updated_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets).Error
	return assets, total, err
}

// OfficialAssetFacets 返回官方素材的媒体类型与分类计数，
// 与分页查询用同一过滤口径（publishedOnly 决定是否只统计已发布）。
func (r *Repository) OfficialAssetFacets(publishedOnly bool) ([]UserAssetFacetRow, []UserAssetFacetRow, error) {
	base := func() *gorm.DB {
		return officialAssetFilteredQuery(r.db.Model(&model.OfficialAsset{}), OfficialAssetPageFilter{}, publishedOnly)
	}
	var mediaTypeRows []UserAssetFacetRow
	if err := base().Select("media_type AS key, COUNT(*) AS count").Group("media_type").Scan(&mediaTypeRows).Error; err != nil {
		return nil, nil, err
	}
	var categoryRows []UserAssetFacetRow
	if err := base().Select("category AS key, COUNT(*) AS count").Group("category").Scan(&categoryRows).Error; err != nil {
		return nil, nil, err
	}
	return mediaTypeRows, categoryRows, nil
}

// OfficialAssetByID 按 ID 取一行官方素材，不做可见性过滤
// （草稿/已下架是否可见由 service 层判断；找不到返回 gorm.ErrRecordNotFound）。
func (r *Repository) OfficialAssetByID(id string) (*model.OfficialAsset, error) {
	var asset model.OfficialAsset
	if err := r.db.Preload("Media", func(db *gorm.DB) *gorm.DB { return db.Order("position ASC, created_at ASC") }).First(&asset, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

// OfficialAssetByResourceID 按底层 Resource 反查官方素材。
// 资源访问层用它识别“属于官方素材库、但不属于当前用户”的共享资源。
func (r *Repository) OfficialAssetByResourceID(resourceID string) (*model.OfficialAsset, error) {
	var asset model.OfficialAsset
	id := strings.TrimSpace(resourceID)
	if err := r.db.Where("resource_id = ? AND deleted_at IS NULL", id).First(&asset).Error; err == nil {
		return &asset, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := r.db.Joins("JOIN official_asset_media ON official_asset_media.official_asset_id = official_assets.id").Where("official_asset_media.resource_id = ? AND official_assets.deleted_at IS NULL", id).First(&asset).Error; err == nil {
		return &asset, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	var candidates []model.OfficialAsset
	if err := r.db.Where("deleted_at IS NULL AND character_snapshot_json <> ?", "").Find(&candidates).Error; err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		var snapshot struct {
			Images []struct {
				ResourceID string `json:"resourceId"`
			} `json:"images"`
			Representations []struct {
				ResourceID string `json:"resourceId"`
			} `json:"representations"`
			Voice *struct {
				Profile struct {
					SampleResourceID string `json:"sampleResourceId"`
				} `json:"profile"`
			} `json:"voice"`
		}
		if err := json.Unmarshal([]byte(candidate.CharacterSnapshotJSON), &snapshot); err != nil {
			return nil, err
		}
		for _, image := range snapshot.Images {
			if image.ResourceID == id {
				return &candidate, nil
			}
		}
		for _, image := range snapshot.Representations {
			if image.ResourceID == id {
				return &candidate, nil
			}
		}
		if snapshot.Voice != nil && snapshot.Voice.Profile.SampleResourceID == id {
			return &candidate, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

// OfficialAssetImportedByUser 判断用户是否已经导入过某份官方素材。
// 已导入副本在官方素材下架后仍须保持可读。
func (r *Repository) OfficialAssetImportedByUser(officialAssetID string, userID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.OfficialAssetImport{}).
		Where("official_asset_id = ? AND scope = ? AND owner_id = ?", strings.TrimSpace(officialAssetID), model.OfficialAssetImportScopeLibrary, strings.TrimSpace(userID)).
		Count(&count).Error
	if err != nil || count > 0 {
		return count > 0, err
	}
	err = r.db.Model(&model.UserOfficialAssetUse{}).Where("official_asset_id = ? AND user_id = ?", strings.TrimSpace(officialAssetID), strings.TrimSpace(userID)).Count(&count).Error
	return count > 0, err
}

// UpdateOfficialAssetFields 按字段更新一行官方素材（不含 status 流转专用的
// published_at 语义——调用方把要改的字段连同 updated_at 一起放进 fields）。
// 返回实际影响行数；0 表示该行不存在或已被软删，调用方应按不存在处理。
func (r *Repository) UpdateOfficialAssetFields(id string, fields map[string]any) (int64, error) {
	result := r.db.Model(&model.OfficialAsset{}).Where("id = ? AND deleted_at IS NULL", strings.TrimSpace(id)).Updates(fields)
	return result.RowsAffected, result.Error
}

// SoftDeleteOfficialAsset 软删除一行官方素材（置 deleted_at）。
// 只删尚未软删的行；已发布/已下架的删除拦截在 service 层，不在这里判断。
func (r *Repository) SoftDeleteOfficialAsset(id string, now time.Time) error {
	return r.db.Model(&model.OfficialAsset{}).Where("id = ? AND deleted_at IS NULL", strings.TrimSpace(id)).Update("deleted_at", now).Error
}

// OfficialAssetImportCount 返回引用某官方素材的导入记录数，
// 删除草稿前用它判定（>0 拒绝删除）。
func (r *Repository) OfficialAssetImportCount(officialAssetID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.OfficialAssetImport{}).Where("official_asset_id = ?", strings.TrimSpace(officialAssetID)).Count(&count).Error
	if err != nil {
		return 0, err
	}
	var uses int64
	err = r.db.Model(&model.UserOfficialAssetUse{}).
		Where("official_asset_id = ?", strings.TrimSpace(officialAssetID)).
		Where(`NOT EXISTS (SELECT 1 FROM official_asset_imports i WHERE i.scope = ? AND i.owner_id = user_official_asset_uses.user_id AND i.official_asset_id = user_official_asset_uses.official_asset_id)`, model.OfficialAssetImportScopeLibrary).
		Count(&uses).Error
	return count + uses, err
}

// ImportRecord 按（作用域，归属，官方素材）取导入记录；
// 不存在时返回 gorm.ErrRecordNotFound，调用方不要把它当成 500。
func (r *Repository) ImportRecord(scope string, ownerID string, officialAssetID string) (*model.OfficialAssetImport, error) {
	var record model.OfficialAssetImport
	if err := r.db.First(&record, "scope = ? AND owner_id = ? AND official_asset_id = ?", strings.TrimSpace(scope), strings.TrimSpace(ownerID), strings.TrimSpace(officialAssetID)).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// ImportedAssetIDs 批量查一批官方素材在某作用域/归属下的导入情况，
// 返回 officialAssetID → assetID 的映射（未导入的不在映射里）。
func (r *Repository) ImportedAssetIDs(scope string, ownerID string, officialAssetIDs []string) (map[string]string, error) {
	result := make(map[string]string, len(officialAssetIDs))
	if len(officialAssetIDs) == 0 {
		return result, nil
	}
	var records []model.OfficialAssetImport
	if err := r.db.Where("scope = ? AND owner_id = ? AND official_asset_id IN ?", strings.TrimSpace(scope), strings.TrimSpace(ownerID), officialAssetIDs).Find(&records).Error; err != nil {
		return nil, err
	}
	for _, record := range records {
		result[record.OfficialAssetID] = record.AssetID
	}
	return result, nil
}

// CreateImportedLibraryAsset 在一个事务内创建导入到个人素材库的全部记录：
// Asset + 首版本 + 主表现 + 导入记录。任一步失败全部回滚，
// 不留“有资产无导入记录”或“有导入记录无资产”的半成品。
// 并发重复导入时，导入记录的唯一索引会让后到的事务失败，
// service 层收到错误后重查导入记录，返回先到者已创建的资产（见 app 层）。
func (r *Repository) CreateImportedLibraryAsset(asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation, record *model.OfficialAssetImport) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		if err := tx.Create(record).Error; err != nil {
			return err
		}
		return tx.Create(&model.UserOfficialAssetUse{ID: kernel.NewID(), UserID: record.OwnerID, OfficialAssetID: record.OfficialAssetID, AssetID: record.AssetID, CreatedAt: record.CreatedAt}).Error
	})
}

// ImportOfficialAssetToProject 在一个事务内完成导入到项目的全部写入：
// Asset（已存在时幂等跳过）+ 项目链接（已存在时幂等跳过）+ 首版本
// （仅链接新建时创建）+ 主表现（仅链接新建时创建，与版本同事务，
// 仿照 project_asset_image.go:129 的项目图片绑定）+ 导入记录 + 项目修订号 +1。
//
// 刻意不直接复用 LinkProjectAsset：后者自己开事务，嵌套调用依赖
// GORM 保存点语义，且它不写导入记录——分开提交会在“链接已建、
// 导入记录未写”的窗口里留下重复导入可建第二条资产的缺口。
// 本方法按 LinkProjectAsset 的语句逐条镜像（见 repository_projects.go），
// 两处逻辑若日后有改动应同步改。
// 返回 createdLink：链接是否为本次新建；false 表示该（项目，资产）
// 链接已存在，调用方应重查导入记录后返回已导入资产。
func (r *Repository) ImportOfficialAssetToProject(asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation, link *model.ProjectAssetLink, record *model.OfficialAssetImport) (bool, error) {
	createdLink := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		assetCreated := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(asset)
		if assetCreated.Error != nil {
			return assetCreated.Error
		}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "project_id"}, {Name: "asset_id"}}, DoNothing: true}).Create(link)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return nil
		}
		createdLink = true
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{
			"category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "updated_at": asset.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(&model.Project{}).Where("id = ?", link.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		return tx.Create(record).Error
	})
	if err != nil {
		return false, err
	}
	// 链接已存在时本事务只读不写：导入记录也已存在（或正由并发事务写入），
	// 调用方重查导入记录即可，不要在这里再补写。
	if !createdLink {
		return false, nil
	}
	return true, nil
}

// IsOfficialAssetImportNotFound 报告错误是否为“导入记录不存在”。
// service 层用它区分“未导入过”（走新建流程）与真正的读库失败。
func IsOfficialAssetImportNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
