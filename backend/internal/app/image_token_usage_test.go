package app

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestParseImageTokenUsage(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want imageTokenUsage
		ok   bool
	}{
		{"text to image", `{"input_tokens":10,"output_tokens":200,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}`, imageTokenUsage{TextInput: 10, Output: 200}, true},
		{"image edit", `{"input_tokens":50,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":40}}`, imageTokenUsage{TextInput: 10, ImageInput: 40, Output: 100}, true},
		{"missing breakdown", `{"input_tokens":50,"output_tokens":100}`, imageTokenUsage{}, false},
		{"inconsistent breakdown", `{"input_tokens":50,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":39}}`, imageTokenUsage{}, false},
		{"non-image output", `{"input_tokens":50,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":40},"output_tokens_details":{"image_tokens":99,"text_tokens":1}}`, imageTokenUsage{}, false},
		{"missing output", `{"input_tokens":10,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}`, imageTokenUsage{}, false},
		{"negative output", `{"input_tokens":10,"output_tokens":-1,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}`, imageTokenUsage{}, false},
		{"fractional count", `{"input_tokens":10,"output_tokens":1.5,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}`, imageTokenUsage{}, false},
		{"overflow count", `{"input_tokens":10,"output_tokens":9223372036854775808,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}`, imageTokenUsage{}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var usage map[string]any
			require.NoError(t, json.Unmarshal([]byte(tc.raw), &usage))
			got, ok := parseImageTokenUsage(usage)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestImageTokenUsageCannotBeOverwrittenByUnrelatedMetadata(t *testing.T) {
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(`{"usage":{"input_tokens":50,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":40}},"usageMetadata":{"promptTokenCount":999,"candidatesTokenCount":999}}`), &payload))
	log := &model.ApiCallLog{Capability: "image"}
	(&Service{}).enrichAPICallLogPayload(log, payload)
	assert.True(t, log.ImageTokenUsageValid)
	assert.Equal(t, int64(50), log.InputTokens)
	assert.Equal(t, int64(40), log.ImageInputTokens)
	assert.Equal(t, int64(100), log.OutputTokens)
}
