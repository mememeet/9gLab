package model

import "time"

const (
	GatewayAssetBindingSyncing = "syncing"
	GatewayAssetBindingReady   = "ready"
	GatewayAssetBindingFailed  = "failed"
)

// GatewayAssetBinding links a user-owned Resource to the stable logical asset
// ID returned by an OpenAI-compatible gateway. Provider-specific IDs never
// belong here; the gateway owns their lifecycle after channel selection.
type GatewayAssetBinding struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"size:36;not null;uniqueIndex:idx_gateway_asset_resource_scope,priority:1;index"`
	ResourceID     string    `json:"resourceId" gorm:"size:36;not null;uniqueIndex:idx_gateway_asset_resource_scope,priority:2;index"`
	GatewayOrigin  string    `json:"gatewayOrigin" gorm:"size:512;not null;uniqueIndex:idx_gateway_asset_resource_scope,priority:3"`
	GatewayAssetID string    `json:"gatewayAssetId" gorm:"size:80;index"`
	Status         string    `json:"status" gorm:"size:24;not null;index"`
	Attempts       int       `json:"attempts"`
	LastError      string    `json:"-" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt" gorm:"index"`
}
