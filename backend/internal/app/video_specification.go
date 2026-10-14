package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type videoSpecification struct {
	Ratio      string `json:"ratio"`
	Resolution string `json:"resolution"`
	Seconds    int    `json:"seconds"`
}

type videoOutputMetadata struct {
	Width      int   `json:"width"`
	Height     int   `json:"height"`
	DurationMs int64 `json:"durationMs"`
}

type videoSpecificationCheck struct {
	Requested videoSpecification  `json:"requested"`
	Actual    videoOutputMetadata `json:"actual"`
	Status    string              `json:"status"`
	Warnings  []string            `json:"warnings"`
}

// Probe only the already-downloaded local container. No network protocols or
// playlist formats are allowed, and malformed files cannot occupy a worker.
func probeVideoOutput(path string) videoOutputMetadata {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path).Output()
	if err != nil {
		return videoOutputMetadata{}
	}
	var data struct {
		Streams []struct {
			Width  int `json:"width"`
			Height int `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(output, &data) != nil || len(data.Streams) == 0 {
		return videoOutputMetadata{}
	}
	seconds, err := strconv.ParseFloat(data.Format.Duration, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds > 86400 {
		return videoOutputMetadata{}
	}
	if data.Streams[0].Width <= 0 || data.Streams[0].Height <= 0 || data.Streams[0].Width > 32768 || data.Streams[0].Height > 32768 {
		return videoOutputMetadata{}
	}
	return videoOutputMetadata{Width: data.Streams[0].Width, Height: data.Streams[0].Height, DurationMs: int64(math.Round(seconds * 1000))}
}

func checkVideoSpecification(requested videoSpecification, actual videoOutputMetadata) videoSpecificationCheck {
	check := videoSpecificationCheck{Requested: requested, Actual: actual, Status: "matched", Warnings: []string{}}
	if actual.Width <= 0 || actual.Height <= 0 || actual.DurationMs <= 0 {
		check.Status = "unverified"
		check.Warnings = append(check.Warnings, "视频已保存，但无法读取真实尺寸和时长，规格尚未核验；请联系管理员检查媒体探测依赖")
		return check
	}
	if requested.Seconds > 0 && math.Abs(float64(actual.DurationMs)-float64(requested.Seconds)*1000) > 250 {
		check.Warnings = append(check.Warnings, fmt.Sprintf("所选时长 %d 秒，实际视频 %.2f 秒", requested.Seconds, float64(actual.DurationMs)/1000))
	}
	if left, right, ok := strings.Cut(requested.Ratio, ":"); ok {
		width, werr := strconv.ParseFloat(left, 64)
		height, herr := strconv.ParseFloat(right, 64)
		if werr == nil && herr == nil && width > 0 && height > 0 {
			expected := width / height
			if math.Abs(float64(actual.Width)/float64(actual.Height)/expected-1) > 0.01 {
				check.Warnings = append(check.Warnings, fmt.Sprintf("所选比例 %s，实际视频尺寸 %d×%d", requested.Ratio, actual.Width, actual.Height))
			}
		}
	}
	resolution, err := strconv.Atoi(strings.TrimSuffix(strings.ToLower(requested.Resolution), "p"))
	if err == nil && resolution > 0 && math.Abs(float64(min(actual.Width, actual.Height)-resolution)) > 2 {
		check.Warnings = append(check.Warnings, fmt.Sprintf("所选分辨率 %dp，实际视频尺寸 %d×%d", resolution, actual.Width, actual.Height))
	}
	if len(check.Warnings) > 0 {
		check.Status = "mismatch"
		check.Warnings = append(check.Warnings, "作品已保留，请核对后再决定是否重新生成；系统不会自动重试扣费")
	}
	return check
}
