package database

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestImageTokenMigrationPreservesExistingPricesAndOrders(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	require.NoError(t, err)
	for _, sql := range []string{
		`CREATE TABLE channel_models (id TEXT PRIMARY KEY, unit_price_microcredits INTEGER)`,
		`CREATE TABLE channel_model_price_tiers (id TEXT PRIMARY KEY, unit_price_microcredits INTEGER, deleted_at DATETIME)`,
		`CREATE TABLE logical_models (id TEXT PRIMARY KEY)`,
		`CREATE TABLE billing_orders (id TEXT PRIMARY KEY, actual_amount_microcredits INTEGER)`,
		`CREATE TABLE api_call_logs (id TEXT PRIMARY KEY)`,
		`INSERT INTO channel_models VALUES ('cm', 8000000)`,
		`INSERT INTO channel_model_price_tiers VALUES ('tier', 8000000, NULL)`,
		`INSERT INTO billing_orders VALUES ('order', 123456)`,
	} {
		require.NoError(t, db.Exec(sql).Error)
	}
	require.NoError(t, migrateImageTokenBilling(db))
	require.NoError(t, migrateImageTokenBilling(db))
	var tier model.ChannelModelPriceTier
	var order model.BillingOrder
	require.NoError(t, db.First(&tier, "id = ?", "tier").Error)
	require.NoError(t, db.First(&order, "id = ?", "order").Error)
	assert.Equal(t, int64(8000000), tier.UnitPriceMicrocredits)
	assert.Zero(t, tier.ImageInputTokenPriceMicrocredits)
	assert.Zero(t, tier.CostPricing.ImageInputTokenPriceMicrocredits)
	assert.Equal(t, int64(123456), order.ActualAmountMicrocredits)
	assert.Zero(t, order.ImageInputTokenPriceMicrocredits)
}

func TestPostgresImageTokenMigrationPreservesExistingData(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	require.NoError(t, err)
	baseDB, err := base.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = baseDB.Close() })
	schema := fmt.Sprintf("image_token_%d", time.Now().UnixNano())
	require.NoError(t, base.Exec(`CREATE SCHEMA "`+schema+`"`).Error)
	t.Cleanup(func() { require.NoError(t, base.Exec(`DROP SCHEMA "`+schema+`" CASCADE`).Error) })
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	require.NoError(t, err)
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, sql := range []string{
		`CREATE TABLE channel_models (id TEXT PRIMARY KEY, unit_price_microcredits BIGINT)`,
		`CREATE TABLE channel_model_price_tiers (id TEXT PRIMARY KEY, unit_price_microcredits BIGINT, deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE billing_orders (id TEXT PRIMARY KEY, actual_amount_microcredits BIGINT)`,
		`CREATE TABLE api_call_logs (id TEXT PRIMARY KEY)`,
		`INSERT INTO channel_models VALUES ('cm', 8000000)`,
		`INSERT INTO channel_model_price_tiers VALUES ('tier', 8000000, NULL)`,
		`INSERT INTO billing_orders VALUES ('order', 123456)`,
	} {
		require.NoError(t, db.Exec(sql).Error)
	}
	require.NoError(t, migrateImageTokenBilling(db))
	require.NoError(t, migrateImageTokenBilling(db))
	var tier model.ChannelModelPriceTier
	var order model.BillingOrder
	require.NoError(t, db.First(&tier, "id = ?", "tier").Error)
	require.NoError(t, db.First(&order, "id = ?", "order").Error)
	assert.Equal(t, int64(8000000), tier.UnitPriceMicrocredits)
	assert.Zero(t, tier.ImageInputTokenPriceMicrocredits)
	assert.Zero(t, tier.ImageTokenReserveMicrocredits)
	assert.Zero(t, tier.CostPricing.ImageInputTokenPriceMicrocredits)
	assert.Equal(t, int64(123456), order.ActualAmountMicrocredits)

	// Exercise the registered 84 -> 85 upgrade on a full temporary schema.
	for _, table := range []string{"channel_models", "channel_model_price_tiers", "billing_orders", "api_call_logs"} {
		require.NoError(t, db.Exec(`DROP TABLE "`+table+`"`).Error)
	}
	// The minimal fixture above deliberately replaced whole tables. Start a fresh
	// connection so pgx does not reuse prepared SELECT plans for those tables.
	require.NoError(t, sqlDB.Close())
	db, err = Open(Config{Driver: "postgres", DSN: testDSN})
	require.NoError(t, err)
	sqlDB, err = db.DB()
	require.NoError(t, err)
	require.NoError(t, MigrateSchema(db))
	channel := model.ChannelModel{ID: "existing-model", ChannelID: "existing-channel", ModelKey: "gpt-image-2", Capability: "image", BillingMode: "fixed_request", UnitPriceMicrocredits: 8_000_000}
	tier = model.ChannelModelPriceTier{ID: "existing-tier", ChannelModelID: channel.ID, SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "fixed_request", UnitPriceMicrocredits: 8_000_000}
	order = model.BillingOrder{ID: "existing-order", UserID: "existing-user", IdempotencyKey: "existing-request", Capability: "image", BillingMode: "fixed_request", ActualAmountMicrocredits: 8_000_000}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&tier).Error)
	require.NoError(t, db.Create(&order).Error)
	for _, statement := range []string{
		`ALTER TABLE channel_models DROP COLUMN image_input_token_price_microcredits`,
		`ALTER TABLE channel_model_price_tiers DROP COLUMN image_input_token_price_microcredits`,
		`ALTER TABLE channel_model_price_tiers DROP COLUMN image_token_reserve_microcredits`,
		`ALTER TABLE channel_model_price_tiers DROP COLUMN cost_image_input_token_price_microcredits`,
		`ALTER TABLE billing_orders DROP COLUMN image_input_token_price_microcredits`,
		`ALTER TABLE billing_orders DROP COLUMN image_input_tokens`,
		`ALTER TABLE billing_orders DROP COLUMN cost_image_input_token_price_microcredits`,
		`ALTER TABLE api_call_logs DROP COLUMN image_input_tokens`,
		`ALTER TABLE api_call_logs DROP COLUMN image_token_usage_valid`,
		`DELETE FROM schema_migrations WHERE version = 85`,
	} {
		require.NoError(t, db.Exec(statement).Error)
	}
	require.NoError(t, MigrateSchema(db))
	require.NoError(t, RequireSchemaVersion(db))
	var restored model.BillingOrder
	require.NoError(t, db.First(&restored, "id = ?", order.ID).Error)
	assert.Equal(t, int64(8_000_000), restored.ActualAmountMicrocredits)
	assert.Equal(t, "fixed_request", restored.BillingMode)
}
