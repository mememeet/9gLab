package protocol

import (
	"context"
	"testing"
)

func TestSeedreamGatewayImageContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedream-images-compatible.yingce-plugin", "seedream-images-compatible")
	for _, images := range [][]MediaReference{nil, {{DataURL: "data:image/png;base64,a", Role: "edit_source"}, {URL: "https://example.com/b.png", Role: "edit_source"}}} {
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "01-c", Prompt: "character sheet", AspectRatio: "1:1", ImageCount: 1, Images: images}})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if spec.Path != "/v1/images/generations" || body["model"] != "01-c" || body["size"] != "2048x2048" || body["n"] != float64(1) {
			t.Fatalf("invalid gateway request: %s %#v", spec.Path, body)
		}
		if len(images) > 0 {
			refs, ok := body["image"].([]any)
			if !ok || len(refs) != 2 || refs[0] != images[0].DataURL || refs[1] != images[1].URL {
				t.Fatalf("references lost or reordered: %#v", body["image"])
			}
		} else if _, exists := body["image"]; exists {
			t.Fatal("text-to-image request must omit empty references")
		}
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"url":"https://example.com/result.png"}],"usage":{"generated_images":1}}`))
	if err != nil || result.Result == nil || len(result.Result.Images) != 1 {
		t.Fatalf("cannot parse image response: %#v %v", result, err)
	}
}
