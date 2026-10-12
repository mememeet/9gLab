package database

import (
	"bytes"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"yingce/backend/internal/logging"
)

func TestFailedSQLLogsDoNotExposeParameters(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	var output bytes.Buffer
	logging.Setup(logging.Config{Level: slog.LevelInfo, SlowRequest: time.Second, SlowSQL: time.Second, Output: &output})
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.Error(t, db.Exec("UPDATE missing_users SET password_hash = ?, email = ? WHERE id = ?", "fixture-secret-hash", "private@example.invalid", "private-user-id").Error)
	assert.Contains(t, output.String(), "missing_users", "failed statement must remain diagnosable")
	assert.NotContains(t, output.String(), "fixture-secret-hash")
	assert.NotContains(t, output.String(), "private@example.invalid")
	assert.NotContains(t, output.String(), "private-user-id")
}
