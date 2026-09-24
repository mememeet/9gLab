package app

import (
	"errors"
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"
)

// publishLocalProviderResource preserves canvas references while moving a local
// resource to the owner's configured object storage when an upstream needs a URL.
func (s *Service) publishLocalProviderResource(userID string, resource *model.Resource, originalErr error) (string, error) {
	setting, settingID, enabled, err := s.activeResourceOSSSetting(userID)
	if err != nil {
		return "", err
	}
	if !enabled {
		return "", originalErr
	}
	current, body, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return "", err
	}
	defer body.Close()
	if current.Provider != "local" {
		return s.providerResourceURL(current, time.Now().Add(providerResourceURLTTL))
	}
	next := *current
	next.Provider = setting.Provider
	next.Endpoint = setting.Endpoint
	next.Bucket = setting.Bucket
	next.StorageSettingID = settingID
	next.ObjectKey = ossObjectKey(setting, userID, current.Kind, "", current.MimeType, time.Now())
	next.UpdatedAt = time.Now()
	// Validate the destination before uploading; private endpoints still need a
	// configured public proxy, and must not silently become upstream URLs.
	if _, err := s.providerResourceURL(&next, time.Now().Add(providerResourceURLTTL)); err != nil {
		return "", err
	}
	next.ETag, err = putOSSObject(setting, next.ObjectKey, next.MimeType, next.Size, body)
	if err != nil {
		return "", fmt.Errorf("转存参考素材到对象存储失败：%w", err)
	}
	changed, saveErr := s.repo.PromoteLocalResourceStorage(current, &next)
	if saveErr != nil || !changed {
		cleanupErr := deleteOSSObject(setting, next.ObjectKey)
		if saveErr != nil || cleanupErr != nil {
			return "", errors.Join(saveErr, cleanupErr)
		}
		latest, loadErr := s.repo.ResourceForUser(userID, resource.ID)
		if loadErr != nil {
			return "", loadErr
		}
		return s.providerResourceURL(latest, time.Now().Add(providerResourceURLTTL))
	}
	// Keep the original local file for recovery; the logical ID and all canvas
	// references remain unchanged, and later requests reuse the persisted object.
	return s.providerResourceURL(&next, time.Now().Add(providerResourceURLTTL))
}
