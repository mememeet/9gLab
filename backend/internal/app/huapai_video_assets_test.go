package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestHuapaiSeedance25UsesSignedReferenceWithoutGatewayAssetProbe(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.com")
	svc, resource := newGatewayAssetTestService(t)
	input := canvasGenerationInput{
		Mode: "video",
		Config: providerConfig{
			BaseURL: "https://www.huapaitech.cn", InterfaceType: "seedance-videos-compatible",
			Model: "seedance2.5", VideoSeconds: "6", Size: "9:16", VQuality: "720p",
		},
		Prompt:          "animate",
		ReferenceImages: []providerMedia{{ID: "image-1", StorageKey: "resource:" + resource.ID}},
	}
	ctx := context.Background()
	if err := svc.prepareGatewayAssetReferences(ctx, "user-1", &input); err != nil {
		t.Fatalf("unexpected gateway probe: %v", err)
	}
	policy := providerMediaHydrationPolicyFor(ctx, input)
	if !policy.requireURL {
		t.Fatal("Huapai video references require a public URL")
	}
	if err := svc.hydrateGenerationMedia("user-1", &input, policy); err != nil {
		t.Fatal(err)
	}
	media := input.ReferenceImages[0]
	parsed, err := url.Parse(media.URL)
	if err != nil || parsed.Host != "canvas.example.com" || parsed.Query().Get("signature") == "" || parsed.Query().Get("expires") == "" || media.DataURL != "" {
		t.Fatal("expected a signed public reference URL instead of inline image data")
	}
	body := officialVideoCreateBody(t, input)
	images, ok := body["images"].([]any)
	if !ok || len(images) != 1 || images[0] != media.URL {
		t.Fatalf("video request did not include the signed reference: %#v", body["images"])
	}
	if body["model"] != "seedance2.5" || body["duration"] != float64(6) || body["aspect_ratio"] != "9:16" || body["resolution"] != "720p" {
		t.Fatalf("video request parameters = %#v", body)
	}
	if err := svc.hydrateGenerationMedia("another-user", &canvasGenerationInput{ReferenceImages: []providerMedia{{StorageKey: "resource:" + resource.ID}}}, policy); err == nil {
		t.Fatal("another user must not receive a signed URL for the resource")
	}
}

func TestHuapaiSeedance20FastUsesSignedReferenceWithoutGatewayAssetProbe(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.com")
	svc, resource := newGatewayAssetTestService(t)
	input := canvasGenerationInput{
		Mode: "video",
		Config: providerConfig{
			BaseURL: "https://www.huapaitech.cn", InterfaceType: "seedance-videos-compatible",
			Model: "seedance2.0fast", VideoSeconds: "6", Size: "16:9", VQuality: "720p",
		},
		Prompt: "animate", ReferenceImages: []providerMedia{{ID: "image-1", StorageKey: "resource:" + resource.ID}},
	}
	ctx := context.Background()
	if err := svc.prepareGatewayAssetReferences(ctx, "user-1", &input); err != nil {
		t.Fatalf("unexpected gateway probe: %v", err)
	}
	policy := providerMediaHydrationPolicyFor(ctx, input)
	if !policy.requireURL {
		t.Fatal("Huapai fast video references require a public URL")
	}
	if err := svc.hydrateGenerationMedia("user-1", &input, policy); err != nil {
		t.Fatal(err)
	}
	media := input.ReferenceImages[0]
	parsed, err := url.Parse(media.URL)
	if err != nil || parsed.Host != "canvas.example.com" || parsed.Query().Get("signature") == "" || parsed.Query().Get("expires") == "" || media.DataURL != "" {
		t.Fatal("expected a signed public reference URL instead of inline image data")
	}
	body := officialVideoCreateBody(t, input)
	images, ok := body["images"].([]any)
	if !ok || len(images) != 1 || images[0] != media.URL {
		t.Fatalf("video request did not include the signed reference: %#v", body["images"])
	}
	if body["model"] != "seedance2.0fast" || body["duration"] != float64(6) || body["aspect_ratio"] != "16:9" || body["resolution"] != "720p" {
		t.Fatalf("video request parameters = %#v", body)
	}
}

func TestHuapaiSeedance20FastCompatibilityIsScoped(t *testing.T) {
	for _, tc := range []struct {
		name, baseURL, protocol, model string
		want                           bool
	}{
		{"target", "https://www.huapaitech.cn", "seedance-videos-compatible", "seedance2.0fast", true},
		{"versioned", "https://www.huapaitech.cn/v1/", "seedance-videos-compatible", "seedance2.0fast", true},
		{"other host", "https://other.example", "seedance-videos-compatible", "seedance2.0fast", false},
		{"lookalike", "https://www.huapaitech.cn.other.example", "seedance-videos-compatible", "seedance2.0fast", false},
		{"other model", "https://www.huapaitech.cn", "seedance-videos-compatible", "seedance2.0", false},
		{"other protocol", "https://www.huapaitech.cn", "newapi-channel-1", "seedance2.0fast", false},
		{"other path", "https://www.huapaitech.cn/other", "seedance-videos-compatible", "seedance2.0fast", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := providerConfig{BaseURL: tc.baseURL, InterfaceType: tc.protocol, Model: tc.model}
			if got := isHuapaiSeedance20FastVideo(config); got != tc.want {
				t.Fatalf("compatibility = %t, want %t", got, tc.want)
			}
			if !tc.want && tc.protocol == "seedance-videos-compatible" && providerMediaHydrationPolicyFor(context.Background(), canvasGenerationInput{Mode: "video", Config: config}).requireURL {
				t.Fatal("unrelated gateway must retain its original media policy")
			}
		})
	}
}

func TestOtherGatewayBadRequestStillFailsAssetPreparation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc, resource := newGatewayAssetTestService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"Model name not specified, model name cannot be empty"}}`, http.StatusBadRequest)
	}))
	defer server.Close()
	input := canvasGenerationInput{
		Mode: "video", Config: providerConfig{BaseURL: server.URL, InterfaceType: "seedance-videos-compatible", Model: "seedance2.5"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:" + resource.ID}},
	}
	err := svc.prepareGatewayAssetReferences(context.Background(), "user-1", &input)
	if err == nil || !strings.Contains(err.Error(), "检测中转站素材协议失败") {
		t.Fatalf("other gateway's HTTP 400 must remain an error, got %v", err)
	}
}

func TestHuapaiVideoCompatibilityIsRestrictedToTheTarget(t *testing.T) {
	tests := []struct {
		name, baseURL, protocol, model string
		want                           bool
	}{
		{"target", "https://www.huapaitech.cn", "seedance-videos-compatible", "seedance2.5", true},
		{"versioned target", "https://www.huapaitech.cn/v1/", "seedance-videos-compatible", "seedance2.5", true},
		{"another host", "https://other.example", "seedance-videos-compatible", "seedance2.5", false},
		{"lookalike host", "https://www.huapaitech.cn.other.example", "seedance-videos-compatible", "seedance2.5", false},
		{"other model", "https://www.huapaitech.cn", "seedance-videos-compatible", "seedance2.0", false},
		{"other protocol", "https://www.huapaitech.cn", "newapi-channel-1", "seedance2.5", false},
		{"other path", "https://www.huapaitech.cn/other", "seedance-videos-compatible", "seedance2.5", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := providerConfig{BaseURL: tt.baseURL, InterfaceType: tt.protocol, Model: tt.model}
			if got := isHuapaiSeedance25Video(config); got != tt.want {
				t.Fatalf("compatibility = %t, want %t", got, tt.want)
			}
			if !tt.want && tt.protocol == "seedance-videos-compatible" {
				policy := providerMediaHydrationPolicyFor(context.Background(), canvasGenerationInput{Mode: "video", Config: config})
				if policy.requireURL {
					t.Fatal("unrelated Seedance gateway must retain its original media policy")
				}
			}
		})
	}
}
