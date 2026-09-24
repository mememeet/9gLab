package database

import (
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func TestCurrentSchemaVersionMatchesMigrationPlan(t *testing.T) {
	if len(schemaMigrations) == 0 {
		t.Fatal("migration plan is empty")
	}
	latest := schemaMigrations[len(schemaMigrations)-1].version
	if CurrentSchemaVersion != latest {
		t.Fatalf("supported schema version %d does not match latest migration %d", CurrentSchemaVersion, latest)
	}
}

func TestMigrateSchemaRecordsAndValidatesVersion(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-version?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected schema status: %#v", status)
	}
	if !db.Migrator().HasIndex(&schemaMigration{}, "idx_schema_migrations_applied_at") {
		t.Fatal("schema migration v2 did not create the applied_at index")
	}
	if !db.Migrator().HasIndex(&model.ProjectAssetCandidate{}, "idx_project_asset_candidates_pending_identity") {
		t.Fatal("schema migration v3 did not create candidate identity index")
	}
	if !db.Migrator().HasTable(&model.AgentProfile{}) || !db.Migrator().HasIndex(&model.AgentProfile{}, "idx_agent_profiles_scope") {
		t.Fatal("schema migration v15 did not create scoped Agent profiles")
	}
	if !db.Migrator().HasTable(&model.AgentLesson{}) || !db.Migrator().HasIndex(&model.AgentLesson{}, "idx_agent_lessons_status") {
		t.Fatal("schema migration v16 did not create Agent lessons")
	}
	if !db.Migrator().HasIndex(&model.AgentLesson{}, "idx_agent_lessons_author_status") {
		t.Fatal("schema migration v17 did not create owner status index")
	}
	if !db.Migrator().HasTable(&model.AgentMemorySetting{}) {
		t.Fatal("schema migration v18 did not create agent memory settings")
	}
	if !db.Migrator().HasColumn(&model.PaymentProviderConfig{}, "plugin_version") || !db.Migrator().HasColumn(&model.PaymentOrder{}, "plugin_version") {
		t.Fatal("schema migration v19 did not add payment plugin version columns")
	}
	if !db.Migrator().HasTable(&model.BannerAnnouncement{}) {
		t.Fatal("schema migration v20 did not create banner announcements")
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "title_runs") {
		t.Fatal("schema migration v21 did not create banner announcements title_runs")
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "notice_type") {
		t.Fatal("schema migration v22 did not create banner announcements notice_type")
	}
	if !db.Migrator().HasTable(&model.GatewayAssetBinding{}) {
		t.Fatal("schema migration v23 did not create gateway asset bindings")
	}
	if !db.Migrator().HasTable(&model.OfficialAsset{}) || !db.Migrator().HasTable(&model.OfficialAssetMedia{}) || !db.Migrator().HasTable(&model.UserOfficialAssetFavorite{}) || !db.Migrator().HasTable(&model.UserOfficialAssetUse{}) {
		t.Fatal("schema migration v24 did not create the official asset library")
	}
	var alignment schemaMigration
	if err := db.First(&alignment, "version = ?", 25).Error; err != nil {
		t.Fatal(err)
	}
	if alignment.Name != "schema_lineage_alignment" {
		t.Fatalf("canonical migration 25 = %q, want schema_lineage_alignment", alignment.Name)
	}
	if !db.Migrator().HasColumn(&model.Asset{}, "library_saved_at") || !db.Migrator().HasIndex(&model.Asset{}, "LibrarySavedAt") {
		t.Fatal("schema migration v26 did not create explicit asset library membership")
	}
	var membership schemaMigration
	if err := db.First(&membership, "version = ?", 26).Error; err != nil {
		t.Fatal(err)
	}
	if membership.Name != "explicit_asset_library_membership" {
		t.Fatalf("canonical migration 26 = %q, want explicit_asset_library_membership", membership.Name)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migration should be idempotent: %v", err)
	}
}

func TestMigrateSchemaV15UpgradesExistingDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-profiles-v15?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.AgentProfile{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 15).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v14: %v", err)
	}
	if !db.Migrator().HasTable(&model.AgentProfile{}) || !db.Migrator().HasIndex(&model.AgentProfile{}, "idx_agent_profiles_scope") {
		t.Fatal("v15 upgrade did not install Agent profile table and scope index")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV16UpgradesExistingDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-lessons-v16?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.AgentLesson{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 16).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v15: %v", err)
	}
	if !db.Migrator().HasTable(&model.AgentLesson{}) || !db.Migrator().HasIndex(&model.AgentLesson{}, "idx_agent_lessons_status") {
		t.Fatal("v16 upgrade did not install Agent lesson table and status index")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV17UpgradesExistingDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-lessons-v17?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.AgentLesson{}, "idx_agent_lessons_author_status"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 17).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v16: %v", err)
	}
	if !db.Migrator().HasIndex(&model.AgentLesson{}, "idx_agent_lessons_author_status") {
		t.Fatal("v17 upgrade did not install owner status index")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV18UpgradesExistingDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-memory-settings-v18?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.AgentMemorySetting{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 18).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v17: %v", err)
	}
	if !db.Migrator().HasTable(&model.AgentMemorySetting{}) {
		t.Fatal("v18 upgrade did not install agent memory settings")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV19AddsPaymentPluginVersion(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-payment-plugin-version-v19?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.PaymentProviderConfig{}, "PluginVersion"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.PaymentOrder{}, "PluginVersion"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 19).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v18: %v", err)
	}
	if !db.Migrator().HasColumn(&model.PaymentProviderConfig{}, "plugin_version") {
		t.Fatal("v19 upgrade did not add payment_provider_configs.plugin_version")
	}
	if !db.Migrator().HasColumn(&model.PaymentOrder{}, "plugin_version") {
		t.Fatal("v19 upgrade did not add payment_orders.plugin_version")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV20UpgradesExistingDatabaseWithBannerAnnouncements(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-banner-announcements-v20?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.BannerAnnouncement{}) {
		t.Fatal("v20 migration did not create banner_announcements table")
	}
	// 模拟旧库升级：删表 + 删除 v20 记录，重跑迁移应能重建。
	if err := db.Migrator().DropTable(&model.BannerAnnouncement{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 20).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v19: %v", err)
	}
	if !db.Migrator().HasTable(&model.BannerAnnouncement{}) {
		t.Fatal("v20 upgrade did not reinstall banner_announcements table")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV21AddsBannerAnnouncementTitleRuns(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-banner-title-runs-v21?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "title_runs") {
		t.Fatal("v21 migration did not add banner_announcements.title_runs")
	}
	legacy := &model.BannerAnnouncement{ID: "legacy-banner", Title: "旧库通知", Status: "active"}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.BannerAnnouncement{}, "title_runs"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 21).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v20: %v", err)
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "title_runs") {
		t.Fatal("v21 upgrade did not restore banner_announcements.title_runs")
	}
	var stored model.BannerAnnouncement
	if err := db.First(&stored, "id = ?", "legacy-banner").Error; err != nil {
		t.Fatal(err)
	}
	if stored.Title != "旧库通知" {
		t.Fatalf("legacy banner lost during upgrade: %+v", stored)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaV22AddsBannerAnnouncementNoticeType(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-banner-notice-type-v22?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "notice_type") {
		t.Fatal("v22 migration did not add banner_announcements.notice_type")
	}
	legacy := &model.BannerAnnouncement{ID: "legacy-banner-v21", Title: "旧库通知", TitleRunsJSON: `[{"text":"旧库通知"}]`, Status: "active"}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.BannerAnnouncement{}, "notice_type"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 22).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v21: %v", err)
	}
	if !db.Migrator().HasColumn(&model.BannerAnnouncement{}, "notice_type") {
		t.Fatal("v22 upgrade did not restore banner_announcements.notice_type")
	}
	var stored model.BannerAnnouncement
	if err := db.First(&stored, "id = ?", "legacy-banner-v21").Error; err != nil {
		t.Fatal(err)
	}
	if stored.Title != "旧库通知" || stored.TitleRunsJSON != `[{"text":"旧库通知"}]` {
		t.Fatalf("legacy banner lost during upgrade: %+v", stored)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}

func TestMigrateSchemaUpgrades9gLabGatewayAtV16(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-9glab-gateway-v16?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:15] {
		if err := item.apply(db); err != nil {
			t.Fatalf("apply migration %d: %v", item.version, err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateGatewayAssetBindings(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 16, Name: "gateway_asset_bindings", Checksum: gatewayAssetBindingsChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade 9gLab v16 gateway lineage: %v", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
	for version, name := range map[int64]string{17: "agent_lessons", 23: "banner_announcement_notice_type", 24: "gateway_asset_bindings", 25: "official_asset_library", 26: "explicit_asset_library_membership"} {
		var shifted schemaMigration
		if err := db.First(&shifted, "version = ?", version).Error; err != nil {
			t.Fatal(err)
		}
		if shifted.Name != name {
			t.Fatalf("migration %d = %q, want %s", version, shifted.Name, name)
		}
	}
	if !db.Migrator().HasTable(&model.OfficialAsset{}) || !db.Migrator().HasTable(&model.OfficialAssetMedia{}) {
		t.Fatal("legacy v16 lineage did not receive the official asset library")
	}
}

func TestMigrateSchemaUpgradesLegacy9gLabGatewayAtV8(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-legacy-9glab-v8?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:7] {
		if err := item.apply(db); err != nil {
			t.Fatalf("apply migration %d: %v", item.version, err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateGatewayAssetBindings(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 8, Name: "gateway_asset_bindings", Checksum: gatewayAssetBindingsChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade legacy 9gLab v8 gateway lineage: %v", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
	for version, name := range map[int64]string{9: "logical_model_active_code", 16: "agent_profiles", 17: "agent_lessons", 23: "banner_announcement_notice_type", 24: "gateway_asset_bindings", 25: "official_asset_library", 26: "explicit_asset_library_membership"} {
		var shifted schemaMigration
		if err := db.First(&shifted, "version = ?", version).Error; err != nil {
			t.Fatal(err)
		}
		if shifted.Name != name {
			t.Fatalf("migration %d = %q, want %s", version, shifted.Name, name)
		}
	}
	if !db.Migrator().HasTable(&model.OfficialAsset{}) || !db.Migrator().HasTable(&model.UserOfficialAssetUse{}) {
		t.Fatal("legacy v8 lineage did not receive the official asset library")
	}
}

func TestMigrateSchemaV26BackfillsOnlyExplicitLibraryAssets(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-explicit-asset-library-v26?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.Asset{}, "LibrarySavedAt"); err != nil {
		t.Fatal(err)
	}
	createdAt := time.Date(2026, 9, 18, 8, 0, 0, 0, time.UTC)
	rows := []struct {
		id      string
		payload string
	}{
		{id: "manual", payload: `{"id":"manual","metadata":{"source":"manual"}}`},
		{id: "official", payload: `{"id":"official","source":"官方资产库"}`},
		{id: "generated", payload: `{"id":"generated","metadata":{"source":"generation-task"}}`},
		{id: "canvas", payload: `{"id":"canvas","metadata":{"source":"canvas-upload"}}`},
	}
	for _, row := range rows {
		if err := db.Exec(`INSERT INTO assets (id, user_id, kind, category, status, title, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.id, "user-1", "image", "material", "confirmed", row.id, row.payload, createdAt, createdAt).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateSchemaV26(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"manual", "official"} {
		var asset model.Asset
		if err := db.First(&asset, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if asset.LibrarySavedAt == nil || !asset.LibrarySavedAt.Equal(createdAt) || !strings.Contains(asset.PayloadJSON, `"librarySavedAt"`) {
			t.Fatalf("explicit asset %s was not backfilled: %+v", id, asset)
		}
	}
	for _, id := range []string{"generated", "canvas"} {
		var asset model.Asset
		if err := db.First(&asset, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if asset.LibrarySavedAt != nil || strings.Contains(asset.PayloadJSON, `"librarySavedAt"`) {
			t.Fatalf("technical asset %s entered the personal library: %+v", id, asset)
		}
	}
}

func TestMigrateSchemaV23BackfillsCanvasRevisions(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-canvas-revisions-v23?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.CanvasSnapshotResource{}, &model.CanvasSnapshot{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.CanvasProject{}, "Revision"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO canvas_projects (id, user_id, title, payload_json) VALUES ('legacy', 'owner', 'Existing canvas', '{"nodes":[]}')`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 27).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var project model.CanvasProject
	if err := db.First(&project, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if project.Revision != 1 || project.PayloadJSON != `{"nodes":[]}` {
		t.Fatalf("legacy canvas changed: %+v", project)
	}
	if !db.Migrator().HasTable(&model.CanvasSnapshot{}) || !db.Migrator().HasTable(&model.CanvasSnapshotResource{}) {
		t.Fatal("history tables missing")
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migration not idempotent: %v", err)
	}
}

func TestMigrateSchemaV8AllowsReusingArchivedLogicalModelCode(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-logical-model-active-code?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE logical_models (id text PRIMARY KEY, code text NOT NULL, archived_at datetime)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_logical_models_code ON logical_models(code)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('archived', 'gpt-image-2', CURRENT_TIMESTAMP)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSchemaV8(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('active', 'gpt-image-2', NULL)`).Error; err != nil {
		t.Fatalf("reusing archived code after migration: %v", err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('duplicate', 'gpt-image-2', NULL)`).Error; err == nil {
		t.Fatal("active logical model code must remain unique")
	}
}

func TestMigrateSchemaV12AddsAgentTokenChargeLimit(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-token-charge-limit?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE billing_orders (id text PRIMARY KEY)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSchemaV12(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.BillingOrder{}, "ChargeLimitMicrocredits") {
		t.Fatal("migration v12 did not add Agent token charge limit")
	}
}

func TestMigrateSchemaRejectsChecksumMismatch(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-checksum?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&schemaMigration{}).Where("version = ?", CurrentSchemaVersion).Update("checksum", "changed").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
	if err := RequireSchemaVersion(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("schema verification must reject checksum mismatch, got %v", err)
	}
}

func TestMigrateSchemaV3NormalizesLegacyAccessoryCategory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-asset-taxonomy?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.ProjectAssetCandidate{}); err != nil {
		t.Fatal(err)
	}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategory("accessory"), Title: "旧配饰"}
	candidate := model.ProjectAssetCandidate{ID: "candidate-1", ProjectID: "project-1", Name: "旧配饰候选", Category: model.AssetCategory("accessory"), Status: "pending_confirmation"}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSchemaV3(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&asset, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&candidate, "id = ?", candidate.ID).Error; err != nil {
		t.Fatal(err)
	}
	if asset.Category != model.AssetCategoryProp || candidate.Category != model.AssetCategoryProp {
		t.Fatalf("legacy accessory categories = %q/%q, want prop/prop", asset.Category, candidate.Category)
	}
	if candidate.NameKey != model.AssetCandidateNameKey(candidate.Name) {
		t.Fatalf("candidate name key = %q", candidate.NameKey)
	}
}

func TestMigrateSchemaV4AddsResourceUploadKeyToExistingSchema(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-resource-upload-key?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE resources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.BillingOrder{}, &model.OAuthState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:3] {
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migrate existing schema: %v", err)
	}
	if !db.Migrator().HasColumn(&model.Resource{}, "upload_key") {
		t.Fatal("resource upload_key column was not added")
	}
	if !db.Migrator().HasIndex(&model.Resource{}, "idx_resources_user_upload_key") {
		t.Fatal("resource upload key index was not added")
	}
	var status SchemaStatus
	status, err = ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected schema status: %#v", status)
	}

	firstKey := "same-upload"
	if err := db.Exec(`INSERT INTO resources (id, user_id, upload_key) VALUES (?, ?, ?)`, "resource-1", "user-1", firstKey).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO resources (id, user_id, upload_key) VALUES (?, ?, ?)`, "resource-2", "user-1", firstKey).Error; err == nil {
		t.Fatal("duplicate resource upload key should be rejected")
	}
}

func TestMigrateSchemaRepairsLegacyAssetFoldersMigrationOrder(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-legacy-v6-order?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Resource{}, &model.Asset{}, &model.AssetFolder{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.BillingOrder{}, &model.OAuthState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:5] {
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&schemaMigration{Version: 6, Name: "asset_library_folders", Checksum: assetLibraryFoldersChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repair legacy migration order: %v", err)
	}
	if !db.Migrator().HasColumn(&model.Resource{}, "playback_status") || !db.Migrator().HasColumn(&model.Resource{}, "playback_object_key") || !db.Migrator().HasColumn(&model.Resource{}, "playback_error") {
		t.Fatal("legacy database did not receive resource playback columns")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected repaired schema status: %#v", status)
	}
	var applied schemaMigration
	if err := db.First(&applied, "version = ?", 6).Error; err != nil {
		t.Fatal(err)
	}
	if applied.Name != "asset_library_folders" || applied.Checksum != assetLibraryFoldersChecksum {
		t.Fatalf("historical migration 6 must be preserved: %#v", applied)
	}
	var playback schemaMigration
	if err := db.First(&playback, "version = ?", 7).Error; err != nil {
		t.Fatal(err)
	}
	if playback.Name != "resource_playback_variant" || playback.Checksum != resourcePlaybackChecksum {
		t.Fatalf("migration 7 must supply playback schema: %#v", playback)
	}
}

func TestMigrateSchemaRollsBackFailedMigration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-rollback?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}

	original := schemaMigrations
	schemaMigrations = append(append([]migration(nil), original...), migration{
		version:  CurrentSchemaVersion + 1,
		name:     "rollback_probe",
		checksum: "sha256:rollback-probe",
		apply: func(tx *gorm.DB) error {
			if err := tx.Exec("CREATE TABLE migration_rollback_probe (id INTEGER PRIMARY KEY)").Error; err != nil {
				return err
			}
			return errors.New("forced migration failure")
		},
	})
	t.Cleanup(func() { schemaMigrations = original })

	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "forced migration failure") {
		t.Fatalf("expected forced migration failure, got %v", err)
	}
	if db.Migrator().HasTable("migration_rollback_probe") {
		t.Fatal("failed migration left a partial table behind")
	}
	var count int64
	if err := db.Model(&schemaMigration{}).Where("version = ?", CurrentSchemaVersion+1).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed migration was recorded: %d", count)
	}
}

func TestRequireSchemaVersionRejectsUninitializedDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-uninitialized?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := RequireSchemaVersion(db); err == nil || !strings.Contains(err.Error(), "请先执行 migrate-schema up") {
		t.Fatalf("expected missing migration error, got %v", err)
	}
}

func TestMigrateSchemaV13AddsCloudAgentCanvasMutation(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-cloud-agent-canvas-mutation?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.CloudAgentCanvasMutation{}) {
		t.Fatal("migration v13 did not create cloud agent canvas mutation table")
	}
	for _, field := range []string{"RunID", "BeforeSnapshotHash", "AfterSnapshotHash", "BeforeJSON", "HasSubmittedTask", "Status"} {
		if !db.Migrator().HasColumn(&model.CloudAgentCanvasMutation{}, field) {
			t.Fatalf("migration v13 did not add %s", field)
		}
	}
}

func TestMigrateSchemaV30AddsBuiltinTools(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-builtin-tools-v30?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.Tool{}) {
		t.Fatal("migration v30 did not create tools table")
	}
}

func TestMigrateSchemaV31AddsToolUserActions(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-tool-user-actions-v31?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.ToolFavorite{}) {
		t.Fatal("migration v31 did not create tool_favorites table")
	}
}

func TestToolsUpgradeFromMain29PreservesMigrationChecksums(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:tools-main29-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 33 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// The initial migration uses today's model registry; restore the actual v29
	// boundary so this test proves that v30/v31 create the new tables.
	if err := db.Migrator().DropTable(&model.ToolFavorite{}, &model.Tool{}); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable(&model.Tool{}) || db.Migrator().HasTable(&model.ToolFavorite{}) {
		t.Fatal("tool tables must not exist before upgrading v29")
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, version := range []int64{32, 33} {
		var record schemaMigration
		if err := db.First(&record, version).Error; err != nil {
			t.Fatal(err)
		}
		expected := map[int64]string{32: "sha256:agent-execution-journal-v28", 33: "sha256:agent-resource-leases-v29-20260919"}
		if record.Checksum != expected[version] {
			t.Fatal("main checksum changed")
		}
	}
	if !db.Migrator().HasTable(&model.Tool{}) || !db.Migrator().HasTable(&model.ToolFavorite{}) {
		t.Fatal("tools tables missing")
	}
}
