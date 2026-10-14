package kernel

import (
	"encoding/json"
	"strings"
)

// ProviderQuotaMessage recognizes structured provider codes, never words in
// an echoed prompt or diagnostic message. Raw responses must not reach users.
func ProviderQuotaMessage(body string) string {
	var payload struct {
		Error struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(body), &payload) != nil {
		return ""
	}
	for _, code := range []string{payload.Error.Code, payload.Error.Type} {
		switch strings.ToLower(strings.TrimSpace(code)) {
		case "insufficient_user_quota":
			return "模型网关账户余额不足，无法完成本次请求的预扣费；请联系管理员检查渠道关联账户余额。Agent 上下文和输出上限较大，后台短文本测试成功不代表额度足够"
		case "insufficient_quota", "insufficient_balance", "insufficient_token_quota", "quota_exceeded":
			return "模型服务额度不足，请检查渠道余额或配额"
		}
	}
	return ""
}
