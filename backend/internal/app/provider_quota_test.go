package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"yingce/backend/internal/generation"
)

func TestProviderQuotaErrorsAreNotAuthenticationFailures(t *testing.T) {
	for _, status := range []int{400, 403, 429} {
		body := `{"error":{"code":"insufficient_user_quota","message":"secret balance and internal diagnostics"}}`
		for _, message := range []string{(providerHTTPError{StatusCode: status, Body: body}).Error(), (providerHTTPError{StatusCode: status, Body: body}).summary(), (generation.HTTPError{StatusCode: status, Body: body}).Error()} {
			assert.Contains(t, message, "预扣费")
			assert.NotContains(t, message, "鉴权")
			assert.NotContains(t, message, "secret")
		}
	}
	for _, body := range []string{`{"error":{"code":"invalid_api_key","message":"quota"}}`, `not JSON`, `{"error":{"code":403}}`} {
		assert.Contains(t, (providerHTTPError{StatusCode: 403, Body: body}).summary(), "鉴权")
		assert.Contains(t, (generation.HTTPError{StatusCode: 403, Body: body}).Error(), "鉴权")
	}
	assert.Contains(t, (generation.HTTPError{StatusCode: 429, Body: `{"error":{"type":"insufficient_quota"}}`}).Error(), "额度不足")
}
