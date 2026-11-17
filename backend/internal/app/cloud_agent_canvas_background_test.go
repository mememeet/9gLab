package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

// A client can leave its canvas without owning the lifetime of an accepted run.
func TestCloudAgentCanvasRunsContinueWithoutObservers(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"已完成"}}]}`)
	}))
	defer upstream.Close()
	defer unblock()

	initial, db, _, _ := creationTestService(t)
	s := New(initial.repo, initial.dataDir)
	defer s.Close()
	require.NoError(t, db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error)
	for _, id := range []string{"agent-canvas", "second-canvas"} {
		require.NoError(t, db.Create(&model.CanvasProject{ID: id, UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error)
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	defer func() { unblock(); close(stop); <-done }()

	firstRequest := agentTestRequest()
	firstRequest.IdempotencyKey = "background-canvas-a"
	first, err := s.CreateCloudAgentRun("user", firstRequest, "")
	require.NoError(t, err)
	select {
	case <-started:
	case <-time.After(20 * time.Second):
		t.Fatal("first run did not reach the model")
	}

	// No client subscribes to the first run while another canvas starts its own conversation.
	secondRequest := agentTestRequest()
	secondRequest.CanvasID = "second-canvas"
	secondRequest.IdempotencyKey = "background-canvas-b"
	second, err := s.CreateCloudAgentRun("user", secondRequest, "")
	require.NoError(t, err)
	require.NotEqual(t, first.ID, second.ID)
	unblock()
	for _, run := range []*CloudAgentRun{first, second} {
		var observed *CloudAgentRun
		require.Eventually(t, func() bool {
			observed, err = s.CloudAgentRun("user", run.ID)
			return err == nil && cloudAgentRunTerminal(observed.Status)
		}, 45*time.Second, 100*time.Millisecond)
		require.Equal(t, "completed", observed.Status)
		require.Equal(t, run.CanvasID, observed.CanvasID)
	}
	firstPage, err := s.CloudAgentConversations("user", "agent-canvas", "", 20)
	require.NoError(t, err)
	secondPage, err := s.CloudAgentConversations("user", "second-canvas", "", 20)
	require.NoError(t, err)
	require.Len(t, firstPage.Items, 1)
	require.Len(t, secondPage.Items, 1)
	require.Equal(t, first.ID, firstPage.Items[0].LatestRunID)
	require.Equal(t, second.ID, secondPage.Items[0].LatestRunID)
}
