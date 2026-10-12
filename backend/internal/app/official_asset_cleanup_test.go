package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDetachedCleanupPreservesOfficialMediaInEveryPublicationState(t *testing.T) {
	for _, status := range []string{model.OfficialAssetStatusDraft, model.OfficialAssetStatusPublished, model.OfficialAssetStatusRetired} {
		t.Run(status, func(t *testing.T) {
			svc, db, _ := newResourceDeletionTestService(t)
			old := time.Now().Add(-48 * time.Hour)
			resource := model.Resource{ID: "official-media", UserID: "uploader", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "official/image.png", CreatedAt: old, UpdatedAt: old}
			require.NoError(t, db.Create(&resource).Error)
			// Catalog ownership is global; the editor need not be the original uploader.
			require.NoError(t, db.Create(&model.OfficialAsset{ID: "official", CreatedBy: "editor", Status: status, Title: "官方角色"}).Error)
			require.NoError(t, db.Create(&model.OfficialAssetMedia{ID: "media", OfficialAssetID: "official", ResourceID: resource.ID}).Error)

			svc.cleanupDetachedResources()

			_, err := svc.repo.Resource(resource.ID)
			require.NoError(t, err, "startup cleanup must retain official media, including unpublished and retired media")
			var jobs int64
			require.NoError(t, db.Model(&model.ResourceDeletionJob{}).Where("resource_id = ?", resource.ID).Count(&jobs).Error)
			assert.Zero(t, jobs, "retained media must never enter the physical deletion queue")
		})
	}
}

func TestResourceDeletionTransactionRejectsNewOfficialReference(t *testing.T) {
	for _, operation := range []string{"detached", "personal-asset"} {
		t.Run(operation, func(t *testing.T) {
			svc, db, _ := newResourceDeletionTestService(t)
			resource := model.Resource{ID: "official-media", UserID: "uploader", Provider: "local", Status: model.ResourceStatusReady}
			require.NoError(t, db.Create(&resource).Error)
			require.NoError(t, db.Create(&model.Asset{ID: "personal", UserID: resource.UserID, PayloadJSON: "{}"}).Error)
			// Simulate a reference attached after the service's reference snapshot.
			require.NoError(t, db.Create(&model.OfficialAssetMedia{ID: "media", OfficialAssetID: "official", ResourceID: resource.ID}).Error)
			jobs := []model.ResourceDeletionJob{{ID: "deletion", ResourceID: resource.ID, UserID: resource.UserID}}
			var err error
			if operation == "detached" {
				err = svc.repo.DeleteDetachedResources([]model.Resource{resource}, jobs)
			} else {
				err = svc.repo.DeleteAssetsAndResources(resource.UserID, []string{"personal"}, []string{resource.ID}, jobs, true)
			}
			require.ErrorIs(t, err, repository.ErrResourceCleanupStillReferenced)
			_, err = svc.repo.Resource(resource.ID)
			require.NoError(t, err)
			var assetCount, jobCount int64
			require.NoError(t, db.Model(&model.Asset{}).Where("id = ?", "personal").Count(&assetCount).Error)
			require.NoError(t, db.Model(&model.ResourceDeletionJob{}).Where("resource_id = ?", resource.ID).Count(&jobCount).Error)
			assert.EqualValues(t, 1, assetCount)
			assert.Zero(t, jobCount)
		})
	}
}

// 用户彻底删除“加入我的资产”得到的个人副本时，只删除个人记录，官方媒体文件仍被官方资产使用。
func TestPurgingSavedOfficialAssetKeepsOfficialMedia(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{ID: "official-media", UserID: "user-1", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "official/image.png"}
	require.NoError(t, db.Create(&resource).Error)
	require.NoError(t, db.Create(&model.OfficialAsset{ID: "official", CreatedBy: "editor", Status: model.OfficialAssetStatusPublished, Title: "官方角色"}).Error)
	require.NoError(t, db.Create(&model.OfficialAssetMedia{ID: "media", OfficialAssetID: "official", ResourceID: resource.ID}).Error)
	require.NoError(t, db.Create(&model.Asset{ID: "saved", UserID: "user-1", Status: model.AssetVersionStatusArchived, PayloadJSON: `{"resourceId":"official-media"}`}).Error)

	require.NoError(t, svc.PurgeUserAssets("user-1", []string{"saved"}))

	var assetCount, jobCount int64
	require.NoError(t, db.Model(&model.Asset{}).Where("id = ?", "saved").Count(&assetCount).Error)
	require.NoError(t, db.Model(&model.ResourceDeletionJob{}).Where("resource_id = ?", resource.ID).Count(&jobCount).Error)
	assert.Zero(t, assetCount, "the personal copy is removed")
	assert.Zero(t, jobCount, "official media must not be queued for physical deletion")
	_, err := svc.repo.Resource(resource.ID)
	require.NoError(t, err)
}
