package protocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAutoDLH3UpgradeContract(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-h3-zm-u24.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(adapters) != 1 {
		t.Fatalf("adapters: %d", len(adapters))
	}
	a := adapters[0]
	request := GenerationRequest{Model: "minimax_h3_zm_u24", Prompt: "角色在商店里挥手", Duration: 5, Resolution: "768P横",
		Images: []MediaReference{{URL: "https://cdn.example/second.png", Order: 2}, {URL: "https://cdn.example/first.png", Order: 1}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3"}},
	}
	create, err := a.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	b := create.Body.(map[string]any)
	if create.Method != "POST" || create.Path != "/api/v1/comfyui/comfyui_workflow/minimax_h3_zm_u24" || b["ref_image_0"] != "https://cdn.example/first.png" || b["ref_image_1"] != "https://cdn.example/second.png" || b["ref_audio_0"] != "https://cdn.example/voice.mp3" || b["resolution"] != "768p横" || b["duration"] != 5 || b["prompt"] != request.Prompt {
		t.Fatalf("request mismatch: %#v", create)
	}
	for _, key := range []string{"first_frame", "last_frame", "generate_audio", "watermark", "ref_audio_1"} {
		if _, ok := b[key]; ok {
			t.Fatalf("unexpected field %s", key)
		}
	}
	for _, tc := range []struct {
		name   string
		change func(*GenerationRequest)
	}{
		{"missing image", func(r *GenerationRequest) { r.Images = nil }},
		{"too many images", func(r *GenerationRequest) { r.Images = make([]MediaReference, 10) }},
		{"too many audios", func(r *GenerationRequest) { r.Audios = make([]MediaReference, 4) }},
		{"duration", func(r *GenerationRequest) { r.Duration = 16 }},
		{"resolution", func(r *GenerationRequest) { r.Resolution = "720p" }},
		{"workflow", func(r *GenerationRequest) { r.Model = "another-model" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := request
			tc.change(&r)
			if _, err := a.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	created, err := a.ParseCreate(context.Background(), []byte(`{"code":"Success","data":{"task_id":"auto-test","status":"QUEUED"}}`))
	if err != nil || created.TaskID != "auto-test" || created.Status != StatusPending {
		t.Fatalf("create: %#v %v", created, err)
	}
	poll, err := a.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/api/v1/comfyui/comfyui_workflow/result/auto-test" {
		t.Fatalf("poll: %#v %v", poll, err)
	}
	for _, status := range []string{"SUCCESS", "completed"} {
		result, err := a.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"code":"Success","data":{"status":"`+status+`","results":[{"url":"https://cdn.example/video.mp4","type":"video","file_type":"mp4"}]}}`))
		if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || !result.Result.Videos[0].Ephemeral {
			t.Fatalf("result: %#v %v", result, err)
		}
	}
}
