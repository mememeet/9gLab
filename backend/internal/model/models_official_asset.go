package model

import "time"

const (
	OfficialAssetStatusDraft     = "draft"
	OfficialAssetStatusPublished = "published"
	OfficialAssetStatusRetired   = "retired"
)

// OfficialAsset is a platform-owned catalog entry. Its media resources remain
// owned by the administrator who uploaded them; end users receive lightweight
// materializations instead of duplicate physical files.
type OfficialAsset struct {
	ID          string               `json:"id" gorm:"primaryKey;size:36"`
	Title       string               `json:"title" gorm:"size:240;index"`
	Kind        string               `json:"kind" gorm:"index;size:24"`
	Category    AssetCategory        `json:"category" gorm:"index;size:32"`
	Status      string               `json:"status" gorm:"index;size:24"`
	Description string               `json:"description" gorm:"type:text"`
	Prompt      string               `json:"prompt" gorm:"type:text"`
	TagsJSON    string               `json:"-" gorm:"type:text"`
	Source      string               `json:"source" gorm:"size:240"`
	License     string               `json:"license" gorm:"size:500"`
	AIGenerated bool                 `json:"aiGenerated"`
	SortOrder   int                  `json:"sortOrder" gorm:"index"`
	CreatedBy   string               `json:"-" gorm:"index;size:36"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt" gorm:"index"`
	Media       []OfficialAssetMedia `json:"-" gorm:"foreignKey:OfficialAssetID"`
}

type OfficialAssetMedia struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	OfficialAssetID string    `json:"officialAssetId" gorm:"index;size:36;uniqueIndex:idx_official_asset_media_position,priority:1"`
	ResourceID      string    `json:"resourceId" gorm:"index;size:36"`
	Role            string    `json:"role" gorm:"size:32"`
	Position        int       `json:"position" gorm:"uniqueIndex:idx_official_asset_media_position,priority:2"`
	CreatedAt       time.Time `json:"createdAt"`
}

type UserOfficialAssetFavorite struct {
	UserID          string    `json:"userId" gorm:"primaryKey;size:36"`
	OfficialAssetID string    `json:"officialAssetId" gorm:"primaryKey;size:36;index"`
	CreatedAt       time.Time `json:"createdAt"`
}

// UserOfficialAssetUse records the stable relationship between a catalog
// entry and the user's materialized Asset. Retiring a catalog entry hides it
// from discovery but keeps its media readable for recorded uses.
type UserOfficialAssetUse struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	UserID          string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_official_asset_use,priority:1"`
	OfficialAssetID string    `json:"officialAssetId" gorm:"index;size:36;uniqueIndex:idx_user_official_asset_use,priority:2"`
	AssetID         string    `json:"assetId" gorm:"index;size:80"`
	CreatedAt       time.Time `json:"createdAt"`
}
