package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestImageTokenQuoteReservationAndSettlement(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	tier := model.ChannelModelPriceTier{ID: "image-token", SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 30_000_000, ImageTokenReserveMicrocredits: 10_000, PriceConfigured: true, Enabled: true}
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{tier})
	require.NoError(t, db.AutoMigrate(&model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.ApiCallLog{}))
	require.NoError(t, db.Create(&model.User{ID: "image-user", Username: "image-user", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error)
	require.NoError(t, db.Create(&model.CreditAccount{UserID: "image-user", AvailableMicrocredits: 100_000}).Error)
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}}
	quote, err := svc.QuoteChannelModel("image-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	require.NoError(t, err)
	assert.True(t, quote.Estimated)
	assert.True(t, quote.ReservationOnly)
	assert.Equal(t, int64(10_000), quote.AmountMicrocredits)
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	require.NoError(t, err)
	order, err := svc.taskBillingOrder("image-user", &model.Task{ID: "image-task", Type: "canvas_image"}, resolved)
	require.NoError(t, err)
	require.NotNil(t, order)
	assert.Equal(t, quote.AmountMicrocredits, order.AmountMicrocredits)
	assert.Equal(t, int64(8_000_000), order.ImageInputTokenPriceMicrocredits)
	require.NoError(t, svc.repo.ReserveBillingOrder(order))
	// A later admin price change must not change an already reserved order.
	require.NoError(t, db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", tier.ID).Updates(map[string]any{
		"input_token_price_microcredits": 99_000_000, "image_input_token_price_microcredits": 99_000_000, "output_token_price_microcredits": 99_000_000,
	}).Error)
	log := model.ApiCallLog{ID: "image-log", BillingOrderID: order.ID, Capability: "image", Status: model.ApiCallStatusSucceeded}
	svc.EnrichAPICallLog(&log, []byte(`{"usage":{"input_tokens":50,"output_tokens":100,"input_tokens_details":{"text_tokens":10,"image_tokens":40}}}`))
	require.True(t, log.ImageTokenUsageValid)
	require.NoError(t, db.Create(&log).Error)
	require.NoError(t, svc.repo.SettleBillingOrder(order.ID, "provider-request"))
	var settled model.BillingOrder
	require.NoError(t, db.First(&settled, "id = ?", order.ID).Error)
	assert.Equal(t, model.BillingStatusSettled, settled.Status)
	assert.Equal(t, int64(3370), settled.ActualAmountMicrocredits)
	assert.Equal(t, int64(6630), settled.RefundedAmountMicrocredits)
	assert.Equal(t, int64(40), settled.ImageInputTokens)
	require.NoError(t, svc.repo.SettleBillingOrder(order.ID, "provider-request"))
}

func TestImageTokenPriceRequiresExplicitInputPriceAndReserve(t *testing.T) {
	imagePrice, reserve := int64(8_000_000), int64(1_000_000)
	input := ChannelModelPriceTierRequest{InputTokenPriceMicrocredits: 5_000_000, OutputTokenPriceMicrocredits: 30_000_000, ImageInputTokenPriceMicrocredits: &imagePrice, ImageTokenReserveMicrocredits: &reserve}
	require.NoError(t, validateChannelModelTierPricing("image", model.ChannelInterfaceOpenAIImage, "token", input))
	missingPrice := input
	missingPrice.ImageInputTokenPriceMicrocredits = nil
	assert.Error(t, validateChannelModelTierPricing("image", model.ChannelInterfaceOpenAIImage, "token", missingPrice))
	zeroReserve := int64(0)
	input.ImageTokenReserveMicrocredits = &zeroReserve
	assert.Error(t, validateChannelModelTierPricing("image", model.ChannelInterfaceOpenAIImage, "token", input))
	assert.Error(t, validateChannelModelTierPricing("image", model.ChannelInterfaceGeminiImage, "token", input))
}

func TestImageTokenModelSavePersistsAllRates(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Images", BaseURL: "https://example.com/v1", APIKey: "test", APIFormat: "openai", ModelsJSON: `[]`}
	require.NoError(t, db.Create(&channel).Error)
	enabled, imagePrice, reserve := true, int64(8_000_000), int64(2_000_000)
	input := ChannelModelPriceTierRequest{BillingMode: "token", PriceConfigured: true, Enabled: &enabled, InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: &imagePrice, OutputTokenPriceMicrocredits: 30_000_000, ImageTokenReserveMicrocredits: &reserve, CostPricing: model.CreditCostPricing{Configured: true, InputTokenPriceMicrocredits: 1_000_000, ImageInputTokenPriceMicrocredits: 2_000_000, OutputTokenPriceMicrocredits: 3_000_000}}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{ModelKey: "gpt-image-2", Capability: "image", Protocol: string(model.ChannelInterfaceOpenAIImage), CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"), Enabled: &enabled, PriceTiers: []ChannelModelPriceTierRequest{input}})
	require.NoError(t, err)
	reloaded, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.PriceTiers, 1)
	assert.Equal(t, imagePrice, reloaded.PriceTiers[0].ImageInputTokenPriceMicrocredits)
	assert.Equal(t, reserve, reloaded.PriceTiers[0].ImageTokenReserveMicrocredits)
	assert.Equal(t, int64(2_000_000), reloaded.PriceTiers[0].CostPricing.ImageInputTokenPriceMicrocredits)
	public, err := svc.sanitizeChannelModel(reloaded)
	require.NoError(t, err)
	require.Len(t, public.PriceTiers, 1)
	assert.Equal(t, imagePrice, public.PriceTiers[0].ImageInputTokenPriceMicrocredits)
	assert.Equal(t, reserve, public.PriceTiers[0].ImageTokenReserveMicrocredits)
}

func TestImageTokenLogicalCatalogPreservesDistinctInputPrices(t *testing.T) {
	tiers := []model.ChannelModelPriceTier{
		{SelectorJSON: `{}`, BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 30_000_000, ImageTokenReserveMicrocredits: 10_000, PriceConfigured: true, Enabled: true},
		{SelectorJSON: `{}`, BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 9_000_000, OutputTokenPriceMicrocredits: 30_000_000, ImageTokenReserveMicrocredits: 20_000, PriceConfigured: true, Enabled: true},
	}
	cached := cachedLogicalModel{Model: model.LogicalModel{PricePolicy: "channel"}, Routes: []cachedLogicalRoute{{Route: model.LogicalModelRoute{Enabled: true, Weight: 1}, ChannelModel: model.ChannelModel{PriceTiers: tiers}}}}
	public := publicLogicalModelPriceTiers(cached)
	require.Len(t, public, 2)
	assert.Equal(t, int64(8_000_000), public[0].ImageInputTokenPriceMicrocredits)
	assert.Equal(t, int64(20_000), public[1].ImageTokenReserveMicrocredits)
	cached.Routes[0].ChannelModel.PriceCurrency = model.PriceCurrencyUSD
	access := &userGroupAccess{bypassVisibility: true, group: &resolvedUserGroup{UserGroup: model.UserGroup{RatioBasisPoints: 5_000, PointsPerUSD: 7_000_000}}}
	grouped, available, err := (&Service{}).groupLogicalModel(CreditPolicy{DefaultMultiplierBPS: 10_000}, access, cached)
	require.NoError(t, err)
	require.True(t, available)
	groupedTiers := publicLogicalModelPriceTiers(grouped)
	require.Len(t, groupedTiers, 2)
	assert.Equal(t, int64(28_000_000), groupedTiers[0].ImageInputTokenPriceMicrocredits)
	assert.Equal(t, int64(35_000), groupedTiers[0].ImageTokenReserveMicrocredits)
}
