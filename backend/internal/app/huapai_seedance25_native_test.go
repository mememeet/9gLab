package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/protocol"
)

func TestHuapaiSeedance25NativeVideoRequestAndPoll(t *testing.T) {
	input := canvasGenerationInput{
		Mode: "video", Prompt: "orbit around the subject",
		Config:          providerConfig{BaseURL: "https://www.huapaitech.cn/v1", InterfaceType: "seedance-videos-compatible", Model: "seedance2.5", VideoSeconds: "6", Size: "9:16", VQuality: "720p"},
		ReferenceImages: []providerMedia{{ID: "first", URL: "https://canvas.example.com/reference", Role: "first_frame"}},
	}
	routed, adapter, err := huapaiSeedance25NativeAdapter(context.Background(), input)
	require.NoError(t, err)
	assert.Equal(t, input.Config.InterfaceType, routed.Config.InterfaceType)
	assert.Equal(t, "https://www.huapaitech.cn/hs", routed.Config.BaseURL)

	request := protocolRequestFromInput(routed)
	create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{BaseURL: routed.Config.BaseURL, Request: request})
	require.NoError(t, err)
	createURL, err := protocolRequestURL(routed.Config.BaseURL, create)
	require.NoError(t, err)
	assert.Equal(t, "https://www.huapaitech.cn/hs/api/v3/contents/generations/tasks", createURL)
	body, ok := create.Body.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "seedance2.5", body["model"])
	assert.Equal(t, "9:16", body["ratio"])
	assert.Equal(t, "720p", body["resolution"])
	assert.EqualValues(t, 6, body["duration"])
	content, ok := body["content"].([]any)
	require.True(t, ok)
	require.Len(t, content, 2)
	assert.Equal(t, map[string]any{"type": "text", "text": input.Prompt}, content[0])
	assert.Equal(t, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://canvas.example.com/reference"}, "role": "first_frame"}, content[1])

	poll, err := adapter.BuildPoll(context.Background(), protocol.PollContext{BaseURL: routed.Config.BaseURL, Request: request, TaskID: "task-123"})
	require.NoError(t, err)
	pollURL, err := protocolRequestURL(routed.Config.BaseURL, poll)
	require.NoError(t, err)
	assert.Equal(t, "https://www.huapaitech.cn/hs/api/v3/contents/generations/tasks/task-123", pollURL)

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-123","status":"queued"}`))
	require.NoError(t, err)
	assert.Equal(t, "task-123", created.TaskID)
	state, err := adapter.ParsePoll(context.Background(), protocol.PollContext{TaskID: "task-123", Request: request}, []byte(`{"id":"task-123","status":"succeeded","content":{"video_url":"https://cdn.example.com/result.mp4"}}`))
	require.NoError(t, err)
	assert.Equal(t, protocol.StatusSucceeded, state.Status)
	require.NotNil(t, state.Result)
}

func TestHuapaiSeedance25NativeRejectsOtherChannelsAndModels(t *testing.T) {
	for _, config := range []providerConfig{
		{BaseURL: "https://www.huapaitech.cn", InterfaceType: "seedance-videos-compatible", Model: "seedance2.0fast"},
		{BaseURL: "https://other.example", InterfaceType: "seedance-videos-compatible", Model: "seedance2.5"},
		{BaseURL: "https://www.huapaitech.cn.other.example", InterfaceType: "seedance-videos-compatible", Model: "seedance2.5"},
		{BaseURL: "https://www.huapaitech.cn", InterfaceType: "volcengine-ark-video", Model: "seedance2.5"},
	} {
		_, _, err := huapaiSeedance25NativeAdapter(context.Background(), canvasGenerationInput{Config: config})
		require.Error(t, err)
	}
}

func TestHuapaiSeedance25NativeRequiresInstalledAdapter(t *testing.T) {
	ctx := withProtocolRegistry(context.Background(), emptyProtocolRegistry)
	input := canvasGenerationInput{Config: providerConfig{BaseURL: "https://www.huapaitech.cn", InterfaceType: "seedance-videos-compatible", Model: "seedance2.5"}}
	_, _, err := huapaiSeedance25NativeAdapter(ctx, input)
	require.ErrorContains(t, err, "协议未安装")
}

func TestHuapaiSeedance25NativeCreatesAndPollsOnce(t *testing.T) {
	allowLoopbackProviderTest(t)
	input := canvasGenerationInput{
		Mode: "video", Prompt: "orbit",
		Config:          providerConfig{BaseURL: "https://www.huapaitech.cn", APIKey: "test-key", InterfaceType: "seedance-videos-compatible", Model: "seedance2.5", VideoSeconds: "6", Size: "9:16", VQuality: "720p"},
		ReferenceImages: []providerMedia{{URL: "https://canvas.example.com/image", Role: "first_frame"}},
	}
	routed, adapter, err := huapaiSeedance25NativeAdapter(context.Background(), input)
	require.NoError(t, err)
	createCalls, pollCalls := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hs/api/v3/contents/generations/tasks":
			createCalls++
			assert.Equal(t, http.MethodPost, r.Method)
			_, _ = w.Write([]byte(`{"id":"task-123","status":"queued"}`))
		case "/hs/api/v3/contents/generations/tasks/task-123":
			pollCalls++
			_, _ = w.Write([]byte(`{"id":"task-123","status":"succeeded","content":{"video_url":"` + server.URL + `/video.mp4"}}`))
		case "/video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	routed.Config.BaseURL = server.URL + "/hs"
	result, err := runProtocolAdapterTaskWithPolicy(context.Background(), routed, adapter, fastVideoPollPolicy())
	require.NoError(t, err)
	assert.Equal(t, "video", result["mode"])
	assert.Equal(t, 1, createCalls)
	assert.Equal(t, 1, pollCalls)
}
