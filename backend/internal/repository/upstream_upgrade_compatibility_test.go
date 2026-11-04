package repository

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

// The DSN must point to a disposable database created by the released v59
// binary and then upgraded with the candidate migration binary.
func TestUpgradedV59TaskAndResourceOperations(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_UPGRADED_SQLITE_DSN")
	if dsn == "" {
		t.Skip("a disposable upgraded v59 database was not supplied")
	}
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: dsn})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, database.RequireSchemaVersion(db))
	require.False(t, db.Migrator().HasTable("workbench_tools"))
	require.False(t, db.Migrator().HasColumn(&model.Task{}, "workbench_kind"))
	task := model.Task{ID: "upgrade-test-task", UserID: "upgrade-test-user", Type: "canvas_image", Status: model.TaskStatusQueued}
	require.NoError(t, db.Create(&task).Error)
	t.Cleanup(func() { require.NoError(t, db.Delete(&model.Task{}, "id = ?", task.ID).Error) })
	repo := New(db)
	tasks, err := repo.Tasks(task.UserID, 10, "", false)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	require.Equal(t, task.ID, tasks[0].ID)
	_, err = repo.ResourceReferenceSnapshotExcludingAssets(task.UserID, nil, []string{"upgrade-test-resource"})
	require.NoError(t, err)
}
