package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	gatewayAssetClaimTTL = 5 * time.Minute
	gatewayAssetWaitTime = 30 * time.Second
)

type gatewayAssetCapability struct {
	AssetProtocol string `json:"asset_protocol"`
	AssetScope    string `json:"asset_scope"`
}

func (s *Service) prepareGatewayAssetReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	if input == nil || input.Mode != "video" || !shouldSendNewAPIVideoImages(*input) {
		return nil
	}
	switch strings.TrimSpace(input.Config.InterfaceType) {
	case string(model.ChannelInterfaceNewAPIVideo), "newapi-channel-1", "seedance-videos-compatible":
	default:
		return nil
	}
	resourceIndexes := make([]int, 0, len(input.ReferenceImages))
	for index := range input.ReferenceImages {
		media := &input.ReferenceImages[index]
		if strings.HasPrefix(strings.TrimSpace(media.GatewayAssetID), "asset_") {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(media.StorageKey), "resource:") {
			resourceIndexes = append(resourceIndexes, index)
		}
	}
	if len(resourceIndexes) == 0 {
		return nil
	}

	capability, supported, err := gatewayAssetProtocol(ctx, input.Config)
	if err != nil {
		return fmt.Errorf("检测中转站素材协议失败：%w", err)
	}
	if !supported {
		return nil
	}
	origin, err := normalizedGatewayOrigin(input.Config.BaseURL)
	if err != nil {
		return err
	}
	gatewayScope := origin + "|" + firstNonEmpty(strings.TrimSpace(capability.AssetScope), "default")
	for _, index := range resourceIndexes {
		media := &input.ReferenceImages[index]
		resourceID := strings.TrimPrefix(strings.TrimSpace(media.StorageKey), "resource:")
		assetID, syncErr := s.ensureGatewayAsset(ctx, userID, resourceID, gatewayScope, input.Config)
		if syncErr != nil {
			return fmt.Errorf("同步参考素材 %s 到中转站失败：%w", firstNonEmpty(strings.TrimSpace(media.Name), resourceID), syncErr)
		}
		media.GatewayAssetID = assetID
	}
	return nil
}

func gatewayAssetProtocol(ctx context.Context, config providerConfig) (gatewayAssetCapability, bool, error) {
	req, err := http.NewRequestWithContext(withProviderRequestKind(ctx, "asset-capability"), http.MethodGet, apiURL(config.BaseURL, "/files?page_size=1"), nil)
	if err != nil {
		return gatewayAssetCapability{}, false, err
	}
	applyProviderAuth(req, config)
	ApplyOutboundHeaders(req, config.Headers)
	data, _, err := doBinary(req)
	if err != nil {
		var httpErr providerHTTPError
		if errors.As(err, &httpErr) && (httpErr.StatusCode == http.StatusNotFound || httpErr.StatusCode == http.StatusMethodNotAllowed) {
			return gatewayAssetCapability{}, false, nil
		}
		return gatewayAssetCapability{}, false, err
	}
	var capability gatewayAssetCapability
	if err := json.Unmarshal(data, &capability); err != nil {
		return gatewayAssetCapability{}, false, nil
	}
	return capability, capability.AssetProtocol == "logical-v1", nil
}

func normalizedGatewayOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("中转站 Base URL 无效")
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), nil
}

func (s *Service) ensureGatewayAsset(ctx context.Context, userID, resourceID, gatewayScope string, config providerConfig) (string, error) {
	binding, claimed, err := s.repo.ClaimGatewayAssetBinding(userID, resourceID, gatewayScope, newID(), time.Now().Add(-gatewayAssetClaimTTL))
	if err != nil {
		return "", err
	}
	if !claimed && binding.Status == model.GatewayAssetBindingReady && strings.HasPrefix(binding.GatewayAssetID, "asset_") {
		return binding.GatewayAssetID, nil
	}
	if claimed {
		assetID, uploadErr := s.uploadGatewayAsset(ctx, userID, resourceID, config)
		if uploadErr != nil {
			_ = s.repo.FailGatewayAssetBinding(userID, binding.ID, truncateRunes(uploadErr.Error(), 500))
			return "", uploadErr
		}
		if err := s.repo.CompleteGatewayAssetBinding(userID, binding.ID, assetID); err != nil {
			return "", err
		}
		return assetID, nil
	}

	deadline := time.NewTimer(gatewayAssetWaitTime)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-deadline.C:
			return "", errors.New("同一素材正在同步，请稍后重试")
		case <-ticker.C:
			current, loadErr := s.repo.GatewayAssetBindingForResource(userID, resourceID, gatewayScope)
			if loadErr != nil {
				if errors.Is(loadErr, gorm.ErrRecordNotFound) {
					continue
				}
				return "", loadErr
			}
			switch current.Status {
			case model.GatewayAssetBindingReady:
				if strings.HasPrefix(current.GatewayAssetID, "asset_") {
					return current.GatewayAssetID, nil
				}
				return "", errors.New("中转站素材映射缺少素材 ID")
			case model.GatewayAssetBindingFailed:
				return "", errors.New(firstNonEmpty(strings.TrimSpace(current.LastError), "中转站素材同步失败"))
			}
		}
	}
}

func (s *Service) uploadGatewayAsset(ctx context.Context, userID, resourceID string, config providerConfig) (string, error) {
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return "", err
	}
	defer body.Close()
	if resource.Status != model.ResourceStatusReady {
		return "", errors.New("参考素材尚未上传完成")
	}

	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	contentType := multipartWriter.FormDataContentType()
	writeDone := make(chan error, 1)
	go func() {
		writeErr := multipartWriter.WriteField("purpose", "video-input")
		if writeErr == nil {
			writeErr = multipartWriter.WriteField("transfer_policy", "portable")
		}
		if writeErr == nil {
			header := make(textproto.MIMEHeader)
			filename := providerMediaFilename(providerMedia{ID: resource.ID, MimeType: resource.MimeType}, resource.MimeType)
			header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
			header.Set("Content-Type", firstNonEmpty(strings.TrimSpace(resource.MimeType), "application/octet-stream"))
			var part io.Writer
			part, writeErr = multipartWriter.CreatePart(header)
			if writeErr == nil {
				_, writeErr = io.Copy(part, body)
			}
		}
		if closeErr := multipartWriter.Close(); writeErr == nil {
			writeErr = closeErr
		}
		_ = writer.CloseWithError(writeErr)
		writeDone <- writeErr
	}()

	req, err := http.NewRequestWithContext(withProviderRequestKind(ctx, "asset-upload"), http.MethodPost, apiURL(config.BaseURL, "/files"), reader)
	if err != nil {
		_ = reader.CloseWithError(err)
		<-writeDone
		return "", err
	}
	applyProviderAuth(req, config)
	req.Header.Set("Content-Type", contentType)
	ApplyOutboundHeaders(req, config.Headers)
	data, _, requestErr := doBinary(req)
	if requestErr != nil {
		_ = reader.CloseWithError(requestErr)
	}
	writeErr := <-writeDone
	if requestErr != nil {
		return "", requestErr
	}
	if writeErr != nil {
		return "", writeErr
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return "", err
	}
	response.ID = strings.TrimSpace(response.ID)
	if !strings.HasPrefix(response.ID, "asset_") {
		return "", errors.New("中转站未返回有效的逻辑素材 ID")
	}
	return response.ID, nil
}
