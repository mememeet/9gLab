package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func unboundAgentTestRequest(key string) CloudAgentRequest {
	req := agentTestRequest()
	req.CanvasID = ""
	req.ContextScope = nil
	req.IdempotencyKey = key
	return req
}

// 平台级对话不带画布：可以创建运行，且不暴露任何画布工具。
func TestCloudAgentRunWithoutCanvas(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	run, err := s.CreateCloudAgentRun("user", unboundAgentTestRequest("unbound-key-1"), "")
	if err != nil {
		t.Fatalf("unbound run must be admitted: %v", err)
	}
	if run.CanvasID != "" {
		t.Fatalf("unbound run must not report a canvas: %q", run.CanvasID)
	}
	for _, tool := range cloudAgentTools(unboundAgentTestRequest("unbound-key-1")) {
		name := tool["function"].(map[string]any)["name"].(string)
		if strings.HasPrefix(name, "canvas_") || name == "generate_media" || strings.HasPrefix(name, "previs_") {
			t.Fatalf("unbound run exposed canvas tool %s", name)
		}
	}
	// 两段平台级对话互不占用：没有画布锁。
	if _, err := s.CreateCloudAgentRun("user", unboundAgentTestRequest("unbound-key-2"), ""); err != nil {
		t.Fatalf("unbound runs must not block each other: %v", err)
	}
}

func TestCloudAgentUnboundRejectsCanvasContext(t *testing.T) {
	req := unboundAgentTestRequest("unbound-key-3")
	req.ContextScope = []string{"canvas"}
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("unbound run must reject canvas context scope")
	}
	req = unboundAgentTestRequest("unbound-key-4")
	req.FocusNodeIDs = []string{"node"}
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("unbound run must reject focus nodes")
	}
}

// 平台旧对话不能换绑到画布，以免把历史混入画布助手。
func TestCloudAgentContinuationCannotBindCanvas(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", unboundAgentTestRequest("unbound-root"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"好的"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": "completed", "cleanup_pending": false}).Error; err != nil {
		t.Fatal(err)
	}
	next := agentTestRequest()
	next.IdempotencyKey = "bound-continuation"
	if _, err := s.CreateCloudAgentRun("user", next, root.ID); err == nil {
		t.Fatal("unbound conversation was attached to a canvas")
	}
}
