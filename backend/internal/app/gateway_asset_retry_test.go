package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

func TestGatewayAssetPreparationRetryContract(t *testing.T) {
	for _, tc := range []struct {
		name, provider, response string
		status, requests         int
		always, cancel, succeeds bool
	}{
		{name: "materializing then accepted", response: `{"code":"asset_materializing","data":null}`, status: 409, requests: 2, succeeds: true},
		{name: "nested gateway error", response: `{"error":{"code":"asset_materializing"}}`, status: 409, requests: 2, succeeds: true},
		{name: "authorization is not preparation", response: `{"code":"asset_authorization_required"}`, status: 409, requests: 1},
		{name: "generic conflict", response: `{"message":"busy"}`, status: 409, requests: 1},
		{name: "existing task is never resubmitted", response: `{"code":"asset_materializing","data":{"task_id":"existing"}}`, status: 409, requests: 1},
		{name: "server failure is not safe to retry", response: `{"code":"asset_materializing"}`, status: 500, requests: 1},
		{name: "other provider unchanged", provider: "autodl-h3-zm-u24", response: `{"code":"asset_materializing"}`, status: 409, requests: 1},
		{name: "bounded preparation", response: `{"code":"asset_materializing"}`, status: 409, requests: 25, always: true},
		{name: "cancel preparation", response: `{"code":"asset_materializing"}`, status: 409, requests: 1, cancel: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != `{"model":"01-b","prompt":"same prompt"}` {
					t.Errorf("request changed across retries: %s %v", body, err)
				}
				w.Header().Set("Content-Type", "application/json")
				if requests == 1 || tc.always {
					w.Header().Set("Retry-After", "9")
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.response))
					return
				}
				_, _ = w.Write([]byte(`{"id":"video-task","status":"queued"}`))
			}))
			defer server.Close()
			provider := tc.provider
			if provider == "" {
				provider = "seedance-videos-compatible"
			}
			config := providerConfig{BaseURL: server.URL, InterfaceType: provider}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			waits := 0
			wait := func(waitCtx context.Context, delay time.Duration) error {
				waits++
				if delay != 9*time.Second {
					t.Errorf("Retry-After not honored: %v", delay)
				}
				if _, ok := waitCtx.Deadline(); !ok {
					t.Error("preparation wait has no deadline")
				}
				if tc.cancel {
					cancel()
					return ctx.Err()
				}
				return nil
			}
			body, err := executeGatewayAssetPreparationRequest(ctx, config, protocol.RequestSpec{Method: "POST", Path: "/v1/videos", ContentType: "application/json", Body: map[string]any{"model": "01-b", "prompt": "same prompt"}}, wait)
			if tc.succeeds {
				if err != nil || string(body) != `{"id":"video-task","status":"queued"}` {
					t.Fatalf("result %s, error %v", body, err)
				}
			} else if err == nil {
				t.Fatal("expected failure")
			}
			if tc.cancel && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation lost: %v", err)
			}
			if requests != tc.requests {
				t.Fatalf("requests = %d, expected %d", requests, tc.requests)
			}
			if tc.requests == 1 && !tc.cancel && waits != 0 {
				t.Fatal("unsafe error was retried")
			}
		})
	}
}
