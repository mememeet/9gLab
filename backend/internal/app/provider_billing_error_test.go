package app

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskFailureDistinguishesBillingModeFromQuota(t *testing.T) {
	for _, tt := range []struct {
		name string
		body string
		want string
	}{
		{"unsupported mode", `{"error":{"code":"billing_mode_not_supported","message":"async task adaptor does not support per_token billing"}}`, "当前模型的计费方式与生成接口不兼容，请联系管理员调整渠道配置或更换模型"},
		{"insufficient quota", `{"error":{"code":"insufficient_quota","message":"insufficient billing balance"}}`, "模型服务额度不足，请检查渠道余额或配额"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := fmt.Errorf("视频生成失败：%w", providerHTTPError{StatusCode: 400, Body: tt.body})
			message := taskFailureMessage(err)
			require.Contains(t, message, tt.want)
			assert.NotContains(t, message, "per_token")
			assert.NotContains(t, message, tt.body)
		})
	}
}
