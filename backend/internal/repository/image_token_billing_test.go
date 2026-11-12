package repository

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestImageTokenUsageRequiresCompleteBreakdown(t *testing.T) {
	order := model.BillingOrder{Capability: "image", BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 30_000_000, MultiplierBasisPoints: 10_000}
	amount, err := tokenUsageAmount(order, &BillingUsage{InputTokens: 50, ImageInputTokens: 40, OutputTokens: 100, ImageTokenUsageValid: true})
	require.NoError(t, err)
	assert.Equal(t, int64(3370), amount)

	_, err = tokenUsageAmount(order, &BillingUsage{InputTokens: 50, OutputTokens: 100})
	assert.ErrorIs(t, err, ErrBillingUsageUnavailable)
	_, err = tokenUsageAmount(order, &BillingUsage{InputTokens: 50, ImageInputTokens: 51, OutputTokens: 100, ImageTokenUsageValid: true})
	assert.ErrorIs(t, err, ErrBillingUsageUnavailable)
	_, err = tokenUsageAmount(order, &BillingUsage{InputTokens: 50, ImageInputTokens: 40, OutputTokens: 100, CachedTokens: 1, ImageTokenUsageValid: true})
	assert.ErrorIs(t, err, ErrBillingUsageUnavailable)
}

func TestImageInputPriceDoesNotCountAsFree(t *testing.T) {
	assert.False(t, zeroPricedTokenOrder(model.BillingOrder{BillingMode: "token", Capability: "image", ImageInputTokenPriceMicrocredits: 1}))
}

func TestImageTokenSettlementDoesNotGuessMissingProviderUsage(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}))
	require.NoError(t, db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 9000, ReservedMicrocredits: 1000}).Error)
	require.NoError(t, db.Create(&model.BillingOrder{ID: "order", UserID: "user", IdempotencyKey: "image", Capability: "image", BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 30_000_000, AmountMicrocredits: 1000, ReservedAmountMicrocredits: 1000, MultiplierBasisPoints: 10_000, Status: model.BillingStatusRunning}).Error)
	require.NoError(t, db.Create(&model.ApiCallLog{ID: "log", BillingOrderID: "order", Capability: "image", Status: model.ApiCallStatusSucceeded, UsageAvailable: true, InputTokens: 50, OutputTokens: 100}).Error)
	repo := &Repository{db: db}
	assert.ErrorIs(t, repo.SettleBillingOrder("order", ""), ErrBillingUsageUnavailable)
	var order model.BillingOrder
	require.NoError(t, db.First(&order, "id = ?", "order").Error)
	assert.Equal(t, model.BillingStatusRunning, order.Status)
	var account model.CreditAccount
	require.NoError(t, db.First(&account, "user_id = ?", "user").Error)
	assert.Equal(t, int64(9000), account.AvailableMicrocredits)
	assert.Equal(t, int64(1000), account.ReservedMicrocredits)
}
