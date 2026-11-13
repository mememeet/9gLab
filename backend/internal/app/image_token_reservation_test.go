package app

import (
	"bytes"
	"mime/multipart"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"yingce/backend/internal/model"
)

func TestImageTokenReservationUsesImageParameters(t *testing.T) {
	cases := []struct {
		name   string
		intent ModelRequestIntent
		want   imageTokenReservation
	}{
		{"low square", ModelRequestIntent{Options: map[string]any{"size": "1024x1024", "quality": "low"}}, imageTokenReservation{1024, 0, 196}},
		{"medium square with reference", ModelRequestIntent{Inputs: map[string]int{"image": 1}, Options: map[string]any{"size": "1024x1024", "quality": "medium"}}, imageTokenReservation{1024, 4096, 1756}},
		{"automatic quality is conservative", ModelRequestIntent{Options: map[string]any{"size": "1:1", "quality": "auto"}}, imageTokenReservation{1024, 0, 7024}},
		{"two outputs", ModelRequestIntent{Inputs: map[string]int{"image": 2}, Options: map[string]any{"size": "1024x1024", "quality": "low", "count": 2}}, imageTokenReservation{1024, 8192, 392}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := estimateImageTokenReservation("gpt-image-2", tc.intent)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
	_, err := estimateImageTokenReservation("gpt-image-2", ModelRequestIntent{Options: map[string]any{"count": 101}})
	assert.Error(t, err)
	_, err = estimateImageTokenReservation("gpt-image-2", ModelRequestIntent{Inputs: map[string]int{"image": 129}})
	assert.Error(t, err)
}

func TestImageTokenProxyReservationReadsJSONAndMultipartParameters(t *testing.T) {
	jsonIntent := imageTokenProxyIntent([]byte(`{"size":"1536x1024","quality":"medium","n":2}`))
	assert.Equal(t, "1536x1024", jsonIntent.Options["size"])
	assert.Equal(t, "medium", jsonIntent.Options["quality"])
	assert.Equal(t, float64(2), jsonIntent.Options["count"])
	assert.Zero(t, jsonIntent.Inputs["image"])
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("size", "1024x1024"))
	require.NoError(t, writer.WriteField("quality", "low"))
	require.NoError(t, writer.WriteField("n", "2"))
	_, err := writer.CreateFormFile("image[]", "first.png")
	require.NoError(t, err)
	_, err = writer.CreateFormFile("image[]", "second.png")
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	intent := imageTokenProxyIntent(body.Bytes())
	assert.Equal(t, 2, intent.Inputs["image"])
	assert.Equal(t, "low", intent.Options["quality"])
	estimate, err := estimateImageTokenReservation("gpt-image-2", intent)
	require.NoError(t, err)
	assert.Equal(t, imageTokenReservation{1024, 8192, 392}, estimate)
	body.Reset()
	writer = multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("n", "101"))
	require.NoError(t, writer.WriteField("n", "1"))
	require.NoError(t, writer.Close())
	_, err = estimateImageTokenReservation("gpt-image-2", imageTokenProxyIntent(body.Bytes()))
	assert.Error(t, err)
}

func TestImageTokenQuoteAndOrderShareAutomaticReservation(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	tier := model.ChannelModelPriceTier{ID: "auto-tier", SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "token", InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: 8_000_000, OutputTokenPriceMicrocredits: 30_000_000, PriceConfigured: true, Enabled: true}
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{tier})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.SystemSetting{}))
	require.NoError(t, db.Create(&model.User{ID: "auto-user", Username: "auto-user", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error)
	low := ModelRequestIntent{Capability: "image", Options: map[string]any{"size": "1024x1024", "quality": "low"}}
	quoteLow, err := svc.QuoteChannelModel("auto-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: low})
	require.NoError(t, err)
	withReference := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}, Options: map[string]any{"size": "1024x1024", "quality": "high"}}
	quote, err := svc.QuoteChannelModel("auto-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: withReference})
	require.NoError(t, err)
	assert.Greater(t, quote.AmountMicrocredits, quoteLow.AmountMicrocredits)
	input := quoteInput(withReference, channelModel.ModelKey)
	input["prompt"] = "实际提示词不会改变报价的固定输入估算"
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	require.NoError(t, err)
	order, err := svc.taskBillingOrder("auto-user", &model.Task{ID: "auto-task", Type: "canvas_image"}, resolved)
	require.NoError(t, err)
	assert.Equal(t, quote.AmountMicrocredits, order.AmountMicrocredits)
	wide := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}, Options: map[string]any{"size": "16:9", "imageResolution": "2k", "quality": "medium"}}
	wideQuote, err := svc.QuoteChannelModel("auto-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: wide})
	require.NoError(t, err)
	wideInput := quoteInput(wide, channelModel.ModelKey)
	wideInput["config"].(map[string]any)["channelId"] = channel.ID
	wideResolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), wideInput, "canvas_image", "")
	require.NoError(t, err)
	wideOrder, err := svc.taskBillingOrder("auto-user", &model.Task{ID: "wide-task", Type: "canvas_image"}, wideResolved)
	require.NoError(t, err)
	assert.Equal(t, wideQuote.AmountMicrocredits, wideOrder.AmountMicrocredits)
	require.NoError(t, db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", tier.ID).Update("image_token_reserve_microcredits", 1_000_000).Error)
	withFloor, err := svc.QuoteChannelModel("auto-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: withReference})
	require.NoError(t, err)
	assert.Equal(t, int64(1_000_000), withFloor.AmountMicrocredits)
}

func TestImageTokenModelSavesWithoutManualReservation(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "automatic-image", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Images", BaseURL: "https://example.com/v1", APIKey: "test", APIFormat: "openai", ModelsJSON: `[]`}
	require.NoError(t, db.Create(&channel).Error)
	enabled, imagePrice := true, int64(8_000_000)
	tier := ChannelModelPriceTierRequest{BillingMode: "token", Enabled: &enabled, PriceConfigured: true, InputTokenPriceMicrocredits: 5_000_000, ImageInputTokenPriceMicrocredits: &imagePrice, OutputTokenPriceMicrocredits: 30_000_000}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{ModelKey: "gpt-image-2", Capability: "image", Protocol: string(model.ChannelInterfaceOpenAIImage), CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2"), Enabled: &enabled, PriceTiers: []ChannelModelPriceTierRequest{tier}})
	require.NoError(t, err)
	reloaded, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.PriceTiers, 1)
	assert.Zero(t, reloaded.PriceTiers[0].ImageTokenReserveMicrocredits)
	assert.True(t, HasValidPrice(reloaded))
}

func TestFreeImageTokenPriceNeverChargesLegacyReservationFloor(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	tier := model.ChannelModelPriceTier{ID: "free-image", SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "token", ImageTokenReserveMicrocredits: 1_000_000, PriceConfigured: true, Enabled: true}
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{tier})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}))
	require.NoError(t, db.Create(&model.User{ID: "free-user", Username: "free-user", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error)
	require.NoError(t, db.Create(&model.CreditAccount{UserID: "free-user", AvailableMicrocredits: 2_000_000}).Error)
	intent := ModelRequestIntent{Capability: "image"}
	quote, err := svc.QuoteChannelModel("free-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
	require.NoError(t, err)
	assert.Zero(t, quote.AmountMicrocredits)
	input := quoteInput(intent, channelModel.ModelKey)
	input["config"].(map[string]any)["channelId"] = channel.ID
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	require.NoError(t, err)
	order, err := svc.taskBillingOrder("free-user", &model.Task{ID: "free-task", Type: "canvas_image"}, resolved)
	require.NoError(t, err)
	require.Zero(t, order.AmountMicrocredits)
	require.NoError(t, svc.repo.ReserveBillingOrder(order))
	require.NoError(t, svc.repo.SettleBillingOrder(order.ID, ""))
	var account model.CreditAccount
	require.NoError(t, db.First(&account, "user_id = ?", "free-user").Error)
	assert.Equal(t, int64(2_000_000), account.AvailableMicrocredits)
}
