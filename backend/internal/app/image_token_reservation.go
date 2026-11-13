package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"strconv"
	"strings"
)

// Image request quotes do not contain the prompt or image bytes. Use the same
// explicit assumptions for both quoting and reserving, rather than deriving a
// different charge from data that is only available after the user approves.
type imageTokenReservation struct {
	TextInput  int64
	ImageInput int64
	Output     int64
}

// The system proxy receives provider-format JSON or multipart instead of a
// canvas intent. Extract only fields needed for a reservation, never image data.
func imageTokenProxyIntent(body []byte) ModelRequestIntent {
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{}, Options: map[string]any{}}
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil && payload != nil {
		for _, key := range []string{"size", "quality"} {
			if value, ok := payload[key]; ok {
				intent.Options[key] = value
			}
		}
		if value, ok := payload["n"]; ok {
			intent.Options["count"] = value
		}
		for _, key := range []string{"image", "images"} {
			switch value := payload[key].(type) {
			case []any:
				intent.Inputs["image"] += len(value)
			case string:
				if value != "" {
					intent.Inputs["image"]++
				}
			}
		}
		return intent
	}
	// The body boundary is the first line of a well-formed multipart request.
	// An opaque body gets a conservative single-reference fallback.
	intent.Inputs["image"] = 1
	line, _, found := bytes.Cut(body, []byte("\r\n"))
	if !found || !bytes.HasPrefix(line, []byte("--")) || len(line) < 3 || len(line) > 72 {
		return intent
	}
	reader := multipart.NewReader(bytes.NewReader(body), string(line[2:]))
	references := 0
	seen := make(map[string]bool)
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return intent
		}
		name := part.FormName()
		if name == "image" || name == "image[]" {
			references++
		}
		if name == "size" || name == "quality" || name == "n" {
			if seen[name] {
				// Ambiguous duplicate fields must not choose a smaller multiplier
				// than the provider might apply.
				intent.Options["count"] = 101
				return intent
			}
			seen[name] = true
			value, readErr := io.ReadAll(io.LimitReader(part, 513))
			if readErr != nil || len(value) > 512 {
				return intent
			}
			if name == "n" {
				name = "count"
			}
			intent.Options[name] = string(value)
		}
		_ = part.Close()
	}
	intent.Inputs["image"] = references
	return intent
}

func estimateImageTokenReservation(modelKey string, intent ModelRequestIntent) (imageTokenReservation, error) {
	const assumedTextTokens, assumedImageTokens = int64(1024), int64(4096)
	references := intent.Inputs["image"]
	if references < 0 || references > 128 {
		return imageTokenReservation{}, BadAuthRequest("图片 Token 预留的参考图数量必须在 0 到 128 之间")
	}
	count := int64(1)
	if value, exists := intent.Options["count"]; exists && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
		var err error
		count, err = strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		if err != nil || count < 1 || count > 100 {
			return imageTokenReservation{}, BadAuthRequest("图片 Token 预留的生成数量必须在 1 到 100 之间")
		}
	}
	width, height := int64(1024), int64(1024)
	size := strings.ToLower(strings.TrimSpace(fmt.Sprint(intent.Options["size"])))
	resolution := strings.ToLower(strings.TrimSpace(fmt.Sprint(intent.Options["imageResolution"])))
	if size == "" || size == "<nil>" || size == "auto" {
		size = "1:1"
	}
	for _, preset := range openAIImageDefaultSizeTable {
		if size != preset.ratio {
			continue
		}
		index := 0
		if resolution == "2k" {
			index = 1
		} else if resolution == "4k" {
			index = 2
		}
		size = preset.tierSizes[index]
		break
	}
	if left, right, found := strings.Cut(strings.ReplaceAll(size, "×", "x"), "x"); found {
		w, wErr := strconv.ParseInt(left, 10, 64)
		h, hErr := strconv.ParseInt(right, 10, 64)
		if wErr != nil || hErr != nil || w < 1 || h < 1 || w > 8192 || h > 8192 {
			return imageTokenReservation{}, BadAuthRequest("图片 Token 预留的尺寸无效")
		}
		width, height = w, h
	}
	quality := strings.ToLower(strings.TrimSpace(fmt.Sprint(intent.Options["quality"])))
	longGrid := int64(96) // auto/unknown quality may select high.
	if quality == "low" {
		longGrid = 16
	} else if quality == "medium" {
		longGrid = 48
	}
	longEdge, shortEdge := max(width, height), min(width, height)
	shortGrid := max(int64(math.RoundToEven(float64(longGrid*shortEdge)/float64(longEdge))), 1)
	// OpenAI's GPT-Image-2 output-token calculator; other Images-compatible
	// models use this as a conservative heuristic, never as settlement usage.
	output := (longGrid*shortGrid*(2_000_000+width*height) + 3_999_999) / 4_000_000
	if !strings.EqualFold(strings.TrimSpace(modelKey), "gpt-image-2") {
		output = max(output, 6240)
	}
	return imageTokenReservation{TextInput: assumedTextTokens, ImageInput: int64(references) * assumedImageTokens, Output: max(output, 1) * count}, nil
}
