package database

import (
	"io"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFailedSQLLogsDoNotExposeParameters(t *testing.T) {
	reader, writer, err := os.Pipe()
	require.NoError(t, err)
	original := os.Stdout
	os.Stdout = writer
	t.Cleanup(func() {
		os.Stdout = original
		_ = writer.Close()
		_ = reader.Close()
	})
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	os.Stdout = original
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.Error(t, db.Exec("UPDATE missing_users SET password_hash = ?, email = ? WHERE id = ?", "fixture-secret-hash", "private@example.invalid", "private-user-id").Error)
	require.NoError(t, writer.Close())
	output, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Contains(t, string(output), "missing_users", "failed statement must remain diagnosable")
	assert.NotContains(t, string(output), "fixture-secret-hash")
	assert.NotContains(t, string(output), "private@example.invalid")
	assert.NotContains(t, string(output), "private-user-id")
}
