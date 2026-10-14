package app

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestVideoSpecificationSurvivesRecoveryAndPublicResult(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	config := providerConfig{Size: "16:9", VQuality: "720p", VideoSeconds: "15"}
	task := seedMediaTask(t, db, config)
	task.Type = "canvas_video"
	require.NoError(t, db.Save(task).Error)
	resource := model.Resource{ID: newID(), UserID: task.UserID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "fixture.mp4", MimeType: "video/mp4", UploadKey: mediaUploadKey(task.ID, 0), Width: 480, Height: 854, DurationMs: 6061}
	require.NoError(t, db.Create(&resource).Error)
	requested := videoSpecification{Ratio: "9:16", Resolution: "480p", Seconds: 6}
	checkpoint := &mediaCheckpoint{Mode: "video", VideoSpecification: &requested, StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID, MIMEType: "video/mp4"}}}
	require.NoError(t, s.saveMediaCheckpoint(task, checkpoint, "register"))
	// Recovery must use the frozen submitted spec, not a later config/default.
	result, err := s.resumeTaskMedia(context.Background(), task)
	require.NoError(t, err)
	check, ok := result["videoSpecification"].(videoSpecificationCheck)
	require.True(t, ok)
	assert.Equal(t, requested, check.Requested)
	assert.Equal(t, "matched", check.Status)
	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	task.ResultJSON = string(encoded)
	assert.Contains(t, taskForOutput(*task).ResultJSON, `"seconds":6`)
	assert.Contains(t, taskForOutput(*task).ResultJSON, `"durationMs":6061`)
}

func TestVideoSpecificationComparesActualOutput(t *testing.T) {
	requested := videoSpecification{Ratio: "9:16", Resolution: "480p", Seconds: 6}
	for _, test := range []struct {
		name    string
		actual  videoOutputMetadata
		status  string
		warning string
	}{
		{"portrait rounding", videoOutputMetadata{480, 854, 6061}, "matched", ""},
		{"wrong duration", videoOutputMetadata{480, 854, 15070}, "mismatch", "实际视频 15.07 秒"},
		{"wrong ratio", videoOutputMetadata{854, 480, 6061}, "mismatch", "所选比例 9:16"},
		{"wrong resolution", videoOutputMetadata{720, 1280, 6061}, "mismatch", "所选分辨率 480p"},
		{"unknown", videoOutputMetadata{}, "unverified", "尚未核验"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := checkVideoSpecification(requested, test.actual)
			assert.Equal(t, test.status, got.Status)
			encoded, err := json.Marshal(got)
			require.NoError(t, err)
			if test.warning != "" {
				assert.Contains(t, string(encoded), test.warning)
			} else {
				assert.Empty(t, got.Warnings)
			}
		})
	}
}

func TestProbeVideoOutputReadsRealContainer(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}
	path := filepath.Join(t.TempDir(), "portrait.mp4")
	output, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=48x86:r=10", "-t", "1", "-c:v", "mpeg4", path).CombinedOutput()
	require.NoError(t, err, "%s", output)
	actual := probeVideoOutput(path)
	assert.Equal(t, 48, actual.Width)
	assert.Equal(t, 86, actual.Height)
	assert.Equal(t, int64(1000), actual.DurationMs)
	assert.Equal(t, videoOutputMetadata{}, probeVideoOutput(filepath.Join(t.TempDir(), "missing.mp4")))
}
