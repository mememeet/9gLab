package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOfficialAssetTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Resource{},
		&model.Asset{},
		&model.OfficialAsset{},
		&model.OfficialAssetMedia{},
		&model.UserOfficialAssetFavorite{},
		&model.UserOfficialAssetUse{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestOfficialAssetPublishAndMaterializeIsUserScoped(t *testing.T) {
	service, db := newOfficialAssetTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	resource := model.Resource{
		ID: "resource-1", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady,
		MimeType: "image/png", Size: 2048, Width: 1600, Height: 900, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}

	created, err := service.SaveOfficialAsset(admin, "", SaveOfficialAssetRequest{
		Title: "夜间城市空镜", Category: model.AssetCategoryEnvironment, Status: model.OfficialAssetStatusPublished,
		Description: "通用城市环境素材", Tags: []string{"城市", "夜景", "城市"}, Source: "9G 官方", ResourceIDs: []string{resource.ID},
	})
	if err != nil {
		t.Fatalf("SaveOfficialAsset: %v", err)
	}
	if created.Kind != "image" || len(created.Media) != 1 || len(created.Tags) != 2 {
		t.Fatalf("created = %#v, want image with one media and deduplicated tags", created)
	}

	page, err := service.OfficialAssets("user-1", OfficialAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Materialized {
		t.Fatalf("initial page = %#v, want one unmaterialized item", page)
	}

	first, err := service.MaterializeOfficialAsset("user-1", created.ID)
	if err != nil {
		t.Fatalf("MaterializeOfficialAsset: %v", err)
	}
	second, err := service.MaterializeOfficialAsset("user-1", created.ID)
	if err != nil {
		t.Fatalf("MaterializeOfficialAsset second call: %v", err)
	}
	var firstPayload, secondPayload struct {
		ID             string `json:"id"`
		CoverURL       string `json:"coverUrl"`
		LibrarySavedAt string `json:"librarySavedAt"`
		Data           struct {
			DataURL    string `json:"dataUrl"`
			StorageKey string `json:"storageKey"`
		} `json:"data"`
	}
	if err := json.Unmarshal(first, &firstPayload); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(second, &secondPayload); err != nil {
		t.Fatal(err)
	}
	if firstPayload.ID == "" || firstPayload.ID != secondPayload.ID {
		t.Fatalf("materialization is not idempotent: %q != %q", firstPayload.ID, secondPayload.ID)
	}
	if firstPayload.LibrarySavedAt == "" || secondPayload.LibrarySavedAt != firstPayload.LibrarySavedAt {
		t.Fatalf("official asset did not enter the personal library: %#v %#v", firstPayload, secondPayload)
	}
	if !strings.Contains(firstPayload.CoverURL, "/api/official-assets/") || firstPayload.Data.StorageKey != "" {
		t.Fatalf("official asset payload should retain a protected reference: %#v", firstPayload)
	}

	userOnePage, err := service.OfficialAssets("user-1", OfficialAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	userTwoPage, err := service.OfficialAssets("user-2", OfficialAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if !userOnePage.Items[0].Materialized || userTwoPage.Items[0].Materialized {
		t.Fatalf("materialized state leaked across users: user1=%v user2=%v", userOnePage.Items[0].Materialized, userTwoPage.Items[0].Materialized)
	}
	if userTwoPage.Items[0].UseCount != 1 {
		t.Fatalf("UseCount = %d, want global count 1", userTwoPage.Items[0].UseCount)
	}

	retired, err := service.SaveOfficialAsset(admin, created.ID, SaveOfficialAssetRequest{
		Title: created.Title, Category: created.Category, Status: model.OfficialAssetStatusRetired,
		Description: created.Description, Tags: created.Tags, Source: created.Source,
	})
	if err != nil || retired.Status != model.OfficialAssetStatusRetired {
		t.Fatalf("retire asset: view=%#v err=%v", retired, err)
	}
	if _, err := service.OfficialAssetDetail(&model.User{ID: "user-1"}, created.ID); err != nil {
		t.Fatalf("materialized user lost retired asset access: %v", err)
	}
	if _, err := service.OfficialAssetDetail(&model.User{ID: "user-2"}, created.ID); err == nil {
		t.Fatal("retired asset remained visible to a user who never materialized it")
	}
}

func TestOfficialAssetAdminAndMediaReplacementGuards(t *testing.T) {
	service, db := newOfficialAssetTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	for _, resource := range []model.Resource{
		{ID: "image-1", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"},
		{ID: "video-1", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4"},
		{ID: "file-1", UserID: admin.ID, Kind: "file", Status: model.ResourceStatusReady, MimeType: "application/pdf"},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.SaveOfficialAsset(&model.User{ID: "user-1"}, "", SaveOfficialAssetRequest{Title: "invalid", ResourceIDs: []string{"image-1"}}); err == nil {
		t.Fatal("non-admin created an official asset")
	}
	if _, err := service.SaveOfficialAsset(admin, "", SaveOfficialAssetRequest{Title: "mixed", ResourceIDs: []string{"image-1", "video-1"}}); err == nil {
		t.Fatal("mixed media kinds were accepted")
	}
	if _, err := service.SaveOfficialAsset(admin, "", SaveOfficialAssetRequest{Title: "document", ResourceIDs: []string{"file-1"}}); err == nil {
		t.Fatal("unsupported official asset kind was accepted")
	}
	created, err := service.SaveOfficialAsset(admin, "", SaveOfficialAssetRequest{Title: "image", Status: model.OfficialAssetStatusPublished, ResourceIDs: []string{"image-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.MaterializeOfficialAsset("user-1", created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveOfficialAsset(admin, created.ID, SaveOfficialAssetRequest{Title: "replace", Status: model.OfficialAssetStatusPublished, ResourceIDs: []string{"image-1"}}); err == nil {
		t.Fatal("media replacement was accepted after user materialization")
	}
}
