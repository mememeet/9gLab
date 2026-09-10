package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

// Only logical-asset preparation is safe to resubmit: the gateway returns this
// code before creating a billable video task. Network errors and other conflicts
// have no such guarantee and must never be retried here.
func executeProtocolCreateRequest(ctx context.Context, config providerConfig, spec protocol.RequestSpec, wait func(context.Context, time.Duration) error) ([]byte, error) {
	deadline := time.Now().Add(2 * time.Minute)
	for attempt := 0; ; attempt++ {
		body, err := executeProtocolRequest(ctx, config, spec)
		if err == nil {
			return body, nil
		}
		switch config.InterfaceType {
		case "newapi-channel-1", "newapi-channel-2", "seedance-videos-compatible":
		default:
			return nil, err
		}
		var upstream providerHTTPError
		if spec.Method != http.MethodPost || !errors.As(err, &upstream) || upstream.StatusCode != http.StatusConflict {
			return nil, err
		}
		var state struct {
			Code   string `json:"code"`
			ID     string `json:"id"`
			TaskID string `json:"task_id"`
			Error  struct {
				Code string `json:"code"`
			} `json:"error"`
			Data struct {
				ID     string `json:"id"`
				TaskID string `json:"task_id"`
			} `json:"data"`
		}
		if json.Unmarshal([]byte(upstream.Body), &state) != nil || (state.Code != "asset_materializing" && state.Error.Code != "asset_materializing") || state.ID != "" || state.TaskID != "" || state.Data.ID != "" || state.Data.TaskID != "" {
			return nil, err
		}
		if attempt >= 24 || !time.Now().Before(deadline) {
			return nil, errors.New("参考素材准备超时，尚未提交视频生成，请稍后重试")
		}
		delay := 5 * time.Second
		if upstream.RetryAfter > delay {
			delay = upstream.RetryAfter
		}
		if delay > 15*time.Second {
			delay = 15 * time.Second
		}
		waitCtx, cancel := context.WithDeadline(ctx, deadline)
		waitErr := wait(waitCtx, delay)
		cancel()
		if waitErr != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, errors.New("参考素材准备超时，尚未提交视频生成，请稍后重试")
		}
	}
}
