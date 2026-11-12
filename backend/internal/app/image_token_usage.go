package app

import (
	"encoding/json"
	"math"
)

// imageTokenUsage is the provider's complete, validated usage for an image
// request. A missing breakdown cannot be used to apply different input prices.
type imageTokenUsage struct {
	TextInput  int64
	ImageInput int64
	Output     int64
}

func parseImageTokenUsage(usage map[string]any) (imageTokenUsage, bool) {
	readCount := func(value any) (int64, bool) {
		switch n := value.(type) {
		case json.Number:
			v, err := n.Int64()
			return v, err == nil && v >= 0
		case int64:
			return n, n >= 0
		case float64:
			if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n >= float64(math.MaxInt64) || math.Trunc(n) != n {
				return 0, false
			}
			return int64(n), true
		default:
			return 0, false
		}
	}
	total, totalOK := readCount(usage["input_tokens"])
	output, outputOK := readCount(usage["output_tokens"])
	details, detailsOK := usage["input_tokens_details"].(map[string]any)
	if !totalOK || !outputOK || output <= 0 || !detailsOK {
		return imageTokenUsage{}, false
	}
	text, textOK := readCount(details["text_tokens"])
	image, imageOK := readCount(details["image_tokens"])
	if !textOK || !imageOK || text > total || image != total-text {
		return imageTokenUsage{}, false
	}
	if outputDetails, exists := usage["output_tokens_details"]; exists {
		fields, ok := outputDetails.(map[string]any)
		if !ok {
			return imageTokenUsage{}, false
		}
		imageOutput, imageOK := readCount(fields["image_tokens"])
		textOutput, textOK := readCount(fields["text_tokens"])
		if !imageOK || !textOK || textOutput != 0 || imageOutput != output {
			return imageTokenUsage{}, false
		}
	}
	return imageTokenUsage{TextInput: text, ImageInput: image, Output: output}, true
}
