package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPrepareGatewayAssetReferencesUploadsOnceAndReusesBinding(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc, resource := newGatewayAssetTestService(t)
	var uploads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" && auth != "Bearer rotated-key" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/files":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []any{}, "asset_protocol": "logical-v1", "asset_scope": "user_7"})
		case "POST /v1/files":
			uploads.Add(1)
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatalf("parse upload: %v", err)
			}
			if r.FormValue("purpose") != "video-input" || r.FormValue("transfer_policy") != "portable" {
				t.Fatalf("upload fields = %#v", r.MultipartForm.Value)
			}
			file, _, err := r.FormFile("file")
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			data, _ := io.ReadAll(file)
			if !bytes.Equal(data, []byte("shared-image")) {
				t.Fatalf("uploaded data = %q", data)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"asset_shared"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "video-model", InterfaceType: string(model.ChannelInterfaceNewAPIVideo)}
	interfaceTypes := []string{string(model.ChannelInterfaceNewAPIVideo), "newapi-channel-1", "seedance-videos-compatible"}
	for attempt := range interfaceTypes {
		config.InterfaceType = interfaceTypes[attempt]
		if attempt > 0 {
			config.APIKey = "rotated-key"
		}
		input := canvasGenerationInput{
			Mode: "video", Config: config,
			ReferenceImages: []providerMedia{{ID: "image-node", Name: "shared.png", StorageKey: "resource:" + resource.ID}},
		}
		ctx := context.Background()
		if err := svc.prepareGatewayAssetReferences(ctx, "user-1", &input); err != nil {
			t.Fatalf("prepareGatewayAssetReferences() attempt %d error = %v", attempt+1, err)
		}
		if got := input.ReferenceImages[0].GatewayAssetID; got != "asset_shared" {
			t.Fatalf("gateway asset ID = %q", got)
		}
	}
	if got := uploads.Load(); got != 1 {
		t.Fatalf("uploads = %d, want 1", got)
	}
	binding, err := svc.repo.GatewayAssetBindingForResource("user-1", resource.ID, server.URL+"|user_7")
	if err != nil {
		t.Fatal(err)
	}
	if binding.Status != model.GatewayAssetBindingReady || binding.GatewayAssetID != "asset_shared" || binding.Attempts != 1 {
		t.Fatalf("binding = %#v", binding)
	}
}

func TestPrepareGatewayAssetReferencesFallsBackForLegacyGateway(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc, resource := newGatewayAssetTestService(t)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	config := providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "video-model", InterfaceType: string(model.ChannelInterfaceNewAPIVideo)}
	input := canvasGenerationInput{Mode: "video", Config: config, ReferenceImages: []providerMedia{{StorageKey: "resource:" + resource.ID}}}
	ctx := context.Background()
	if err := svc.prepareGatewayAssetReferences(ctx, "user-1", &input); err != nil {
		t.Fatal(err)
	}
	if input.ReferenceImages[0].GatewayAssetID != "" {
		t.Fatalf("legacy gateway unexpectedly produced asset ID %q", input.ReferenceImages[0].GatewayAssetID)
	}
}

func newGatewayAssetTestService(t *testing.T) (*Service, *model.Resource) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.Resource{}, &model.GatewayAssetBinding{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	resource, _, err := svc.storeResource("user-1", "image", "shared.png", "image/png", int64(len("shared-image")), 1, 1, 0, bytes.NewReader([]byte("shared-image")), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	return svc, resource
}
