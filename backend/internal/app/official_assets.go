package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type OfficialAssetQuery struct {
	Page         int
	PageSize     int
	Keyword      string
	Kind         string
	Category     string
	Status       string
	FavoriteOnly bool
}

type OfficialAssetMediaView struct {
	ID         string `json:"id"`
	Role       string `json:"role"`
	Position   int    `json:"position"`
	FileURL    string `json:"fileUrl"`
	Kind       string `json:"kind"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"durationMs"`
}

type OfficialAssetView struct {
	ID            string                   `json:"id"`
	Title         string                   `json:"title"`
	Kind          string                   `json:"kind"`
	Category      model.AssetCategory      `json:"category"`
	Status        string                   `json:"status"`
	Description   string                   `json:"description"`
	Prompt        string                   `json:"prompt"`
	Tags          []string                 `json:"tags"`
	Source        string                   `json:"source"`
	License       string                   `json:"license"`
	AIGenerated   bool                     `json:"aiGenerated"`
	SortOrder     int                      `json:"sortOrder"`
	Favorite      bool                     `json:"favorite"`
	Materialized  bool                     `json:"materialized"`
	UseCount      int64                    `json:"useCount"`
	FavoriteCount int64                    `json:"favoriteCount"`
	Media         []OfficialAssetMediaView `json:"media"`
	CreatedAt     time.Time                `json:"createdAt"`
	UpdatedAt     time.Time                `json:"updatedAt"`
}

type OfficialAssetPage struct {
	Items    []OfficialAssetView `json:"items"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
	Total    int64               `json:"total"`
	HasMore  bool                `json:"hasMore"`
}

type SaveOfficialAssetRequest struct {
	Title       string              `json:"title"`
	Category    model.AssetCategory `json:"category"`
	Status      string              `json:"status"`
	Description string              `json:"description"`
	Prompt      string              `json:"prompt"`
	Tags        []string            `json:"tags"`
	Source      string              `json:"source"`
	License     string              `json:"license"`
	AIGenerated bool                `json:"aiGenerated"`
	SortOrder   int                 `json:"sortOrder"`
	ResourceIDs []string            `json:"resourceIds"`
}

func (s *Service) OfficialAssets(userID string, query OfficialAssetQuery) (OfficialAssetPage, error) {
	query.Status = model.OfficialAssetStatusPublished
	return s.officialAssetPage(userID, query, false)
}

func (s *Service) AdminOfficialAssets(actor *model.User, query OfficialAssetQuery) (OfficialAssetPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetPage{}, err
	}
	return s.officialAssetPage(actor.ID, query, true)
}

func (s *Service) officialAssetPage(userID string, query OfficialAssetQuery, admin bool) (OfficialAssetPage, error) {
	page, pageSize := normalizeProjectPage(query.Page, query.PageSize, 120)
	assets, total, err := s.repo.OfficialAssetPage(repository.OfficialAssetPageFilter{
		Keyword: query.Keyword, Kind: query.Kind, Category: query.Category, Status: query.Status,
		FavoriteOnly: query.FavoriteOnly && !admin, UserID: userID, Limit: pageSize, Offset: (page - 1) * pageSize,
	})
	if err != nil {
		return OfficialAssetPage{}, err
	}
	ids := make([]string, len(assets))
	for index := range assets {
		ids[index] = assets[index].ID
	}
	favoriteIDs, err := s.repo.OfficialAssetFavoriteIDs(userID, ids)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	favorites := make(map[string]bool, len(favoriteIDs))
	for _, id := range favoriteIDs {
		favorites[id] = true
	}
	useCounts, err := s.repo.OfficialAssetUseCounts(ids)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	usedIDs, err := s.repo.OfficialAssetUsedIDs(userID, ids)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	used := make(map[string]bool, len(usedIDs))
	for _, id := range usedIDs {
		used[id] = true
	}
	favoriteCounts, err := s.repo.OfficialAssetFavoriteCounts(ids)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	items := make([]OfficialAssetView, 0, len(assets))
	for index := range assets {
		view, viewErr := s.officialAssetView(&assets[index], favorites[assets[index].ID], used[assets[index].ID], useCounts[assets[index].ID], favoriteCounts[assets[index].ID])
		if viewErr != nil {
			return OfficialAssetPage{}, viewErr
		}
		items = append(items, view)
	}
	return OfficialAssetPage{Items: items, Page: page, PageSize: pageSize, Total: total, HasMore: int64(page*pageSize) < total}, nil
}

func (s *Service) OfficialAssetDetail(user *model.User, id string) (OfficialAssetView, error) {
	asset, err := s.repo.OfficialAsset(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetView{}, NotFound("官方资产不存在")
		}
		return OfficialAssetView{}, err
	}
	use, useErr := s.repo.OfficialAssetUseForUser(user.ID, asset.ID)
	materialized := useErr == nil && use != nil
	if asset.Status != model.OfficialAssetStatusPublished && user.Role != model.UserRoleAdmin && !materialized {
		return OfficialAssetView{}, NotFound("官方资产不存在")
	}
	favorites, err := s.repo.OfficialAssetFavoriteIDs(user.ID, []string{asset.ID})
	if err != nil {
		return OfficialAssetView{}, err
	}
	useCounts, err := s.repo.OfficialAssetUseCounts([]string{asset.ID})
	if err != nil {
		return OfficialAssetView{}, err
	}
	favoriteCounts, err := s.repo.OfficialAssetFavoriteCounts([]string{asset.ID})
	if err != nil {
		return OfficialAssetView{}, err
	}
	return s.officialAssetView(asset, len(favorites) > 0, materialized, useCounts[asset.ID], favoriteCounts[asset.ID])
}

func (s *Service) SaveOfficialAsset(actor *model.User, id string, req SaveOfficialAssetRequest) (OfficialAssetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetView{}, err
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return OfficialAssetView{}, BadAuthRequest("请输入官方资产名称")
	}
	if utf8.RuneCountInString(title) > 120 {
		return OfficialAssetView{}, BadAuthRequest("官方资产名称不能超过 120 个字符")
	}
	category := model.NormalizeAssetCategory(req.Category, "image")
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = model.OfficialAssetStatusDraft
	}
	if status != model.OfficialAssetStatusDraft && status != model.OfficialAssetStatusPublished && status != model.OfficialAssetStatusRetired {
		return OfficialAssetView{}, BadAuthRequest("官方资产状态无效")
	}
	tags := uniqueNonemptyStrings(req.Tags)
	if len(tags) > 24 {
		return OfficialAssetView{}, BadAuthRequest("官方资产最多设置 24 个标签")
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return OfficialAssetView{}, err
	}

	var asset *model.OfficialAsset
	creating := strings.TrimSpace(id) == ""
	if creating {
		if len(req.ResourceIDs) == 0 {
			return OfficialAssetView{}, BadAuthRequest("请至少上传一个官方资产文件")
		}
		asset = &model.OfficialAsset{ID: newID(), CreatedBy: actor.ID, CreatedAt: time.Now().UTC()}
	} else {
		asset, err = s.repo.OfficialAsset(strings.TrimSpace(id))
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return OfficialAssetView{}, NotFound("官方资产不存在")
			}
			return OfficialAssetView{}, err
		}
	}

	var media []model.OfficialAssetMedia
	if req.ResourceIDs != nil {
		if len(req.ResourceIDs) == 0 || len(req.ResourceIDs) > 12 {
			return OfficialAssetView{}, BadAuthRequest("每个官方资产需要 1 到 12 个媒体文件")
		}
		if !creating {
			counts, countErr := s.repo.OfficialAssetUseCounts([]string{asset.ID})
			if countErr != nil {
				return OfficialAssetView{}, countErr
			}
			if counts[asset.ID] > 0 {
				return OfficialAssetView{}, BadAuthRequest("该资产已经被用户使用，不能替换媒体文件；请新建官方资产")
			}
		}
		seen := make(map[string]struct{}, len(req.ResourceIDs))
		for _, rawID := range req.ResourceIDs {
			resourceID := strings.TrimSpace(rawID)
			if resourceID == "" {
				continue
			}
			if _, exists := seen[resourceID]; exists {
				continue
			}
			seen[resourceID] = struct{}{}
			resource, resourceErr := s.repo.ResourceForUser(actor.ID, resourceID)
			if resourceErr != nil || resource.Status != model.ResourceStatusReady {
				return OfficialAssetView{}, BadAuthRequest("官方资产文件不存在或尚未上传完成")
			}
			if len(media) == 0 {
				asset.Kind = resource.Kind
			}
			if resource.Kind != "image" && resource.Kind != "video" && resource.Kind != "audio" {
				return OfficialAssetView{}, BadAuthRequest("官方资产仅支持图片、视频或音频")
			}
			if resource.Kind != asset.Kind {
				return OfficialAssetView{}, BadAuthRequest("同一官方资产的媒体类型必须一致")
			}
			role := "alternate"
			if len(media) == 0 {
				role = "primary"
			}
			media = append(media, model.OfficialAssetMedia{ID: newID(), OfficialAssetID: asset.ID, ResourceID: resource.ID, Role: role, Position: len(media), CreatedAt: time.Now().UTC()})
		}
		if len(media) == 0 {
			return OfficialAssetView{}, BadAuthRequest("请至少上传一个有效的官方资产文件")
		}
	}

	now := time.Now().UTC()
	asset.Title = title
	asset.Category = category
	asset.Status = status
	asset.Description = strings.TrimSpace(req.Description)
	asset.Prompt = strings.TrimSpace(req.Prompt)
	asset.TagsJSON = string(tagsJSON)
	asset.Source = strings.TrimSpace(req.Source)
	asset.License = strings.TrimSpace(req.License)
	asset.AIGenerated = req.AIGenerated
	asset.SortOrder = req.SortOrder
	asset.UpdatedAt = now
	if creating {
		if err := s.repo.CreateOfficialAsset(asset, media); err != nil {
			return OfficialAssetView{}, err
		}
	} else {
		if err := s.repo.UpdateOfficialAsset(asset); err != nil {
			return OfficialAssetView{}, err
		}
		if req.ResourceIDs != nil {
			if err := s.repo.ReplaceOfficialAssetMedia(asset.ID, media); err != nil {
				return OfficialAssetView{}, err
			}
		}
	}
	return s.OfficialAssetDetail(actor, asset.ID)
}

func (s *Service) SetOfficialAssetFavorite(userID string, id string, favorite bool) error {
	asset, err := s.repo.OfficialAsset(strings.TrimSpace(id))
	if err != nil || asset.Status != model.OfficialAssetStatusPublished {
		return NotFound("官方资产不存在")
	}
	return s.repo.SetOfficialAssetFavorite(userID, asset.ID, favorite)
}

func (s *Service) MaterializeOfficialAsset(userID string, id string) (json.RawMessage, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	asset, err := s.repo.OfficialAsset(strings.TrimSpace(id))
	if err != nil || asset.Status != model.OfficialAssetStatusPublished {
		return nil, NotFound("官方资产不存在")
	}
	if existing, existingErr := s.repo.OfficialAssetUseForUser(userID, asset.ID); existingErr == nil {
		userAsset, loadErr := s.repo.AssetForUser(userID, existing.AssetID)
		if loadErr != nil {
			return nil, loadErr
		}
		return clientAssetPayload(*userAsset), nil
	} else if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return nil, existingErr
	}
	if len(asset.Media) == 0 {
		return nil, BadAuthRequest("官方资产没有可用媒体")
	}
	primary := asset.Media[0]
	resource, err := s.repo.Resource(primary.ResourceID)
	if err != nil || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("官方资产文件暂不可用")
	}
	fileURL := officialAssetMediaFileURL(asset.ID, primary.ID)
	now := time.Now().UTC()
	assetID := newID()
	tags := officialAssetTags(asset.TagsJSON)
	data := map[string]any{"url": fileURL, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs, "bytes": resource.Size, "mimeType": resource.MimeType}
	if asset.Kind == "image" {
		data = map[string]any{"dataUrl": fileURL, "width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType}
	}
	payload := map[string]any{
		"id": assetID, "kind": asset.Kind, "title": asset.Title, "category": asset.Category,
		"status": model.AssetVersionStatusConfirmed, "coverUrl": fileURL, "tags": tags,
		"librarySavedAt": now.Format(time.RFC3339Nano),
		"source":         "官方资产库", "note": asset.Description, "createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
		"metadata": map[string]any{"source": "official", "officialAssetId": asset.ID, "officialMediaId": primary.ID}, "data": data,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	userAsset := &model.Asset{ID: assetID, UserID: userID, LibrarySavedAt: &now, Kind: asset.Kind, Category: asset.Category, Status: model.AssetVersionStatusConfirmed, Title: asset.Title, PayloadJSON: string(payloadJSON), CreatedAt: now, UpdatedAt: now}
	use := &model.UserOfficialAssetUse{ID: newID(), UserID: userID, OfficialAssetID: asset.ID, AssetID: assetID, CreatedAt: now}
	if err := s.repo.CreateOfficialAssetMaterialization(userAsset, use); err != nil {
		return nil, err
	}
	return clientAssetPayload(*userAsset), nil
}

func (s *Service) OpenOfficialAssetMedia(user *model.User, assetID string, mediaID string, rangeHeader string) (*ResourceStream, error) {
	asset, err := s.repo.OfficialAsset(strings.TrimSpace(assetID))
	if err != nil {
		return nil, NotFound("官方资产不存在")
	}
	allowed := asset.Status == model.OfficialAssetStatusPublished || user.Role == model.UserRoleAdmin
	if !allowed {
		_, useErr := s.repo.OfficialAssetUseForUser(user.ID, asset.ID)
		allowed = useErr == nil
	}
	if !allowed {
		return nil, Forbidden("官方资产不可用")
	}
	var selected *model.OfficialAssetMedia
	for index := range asset.Media {
		if asset.Media[index].ID == strings.TrimSpace(mediaID) {
			selected = &asset.Media[index]
			break
		}
	}
	if selected == nil {
		return nil, NotFound("官方资产文件不存在")
	}
	resource, err := s.repo.Resource(selected.ResourceID)
	if err != nil {
		return nil, NotFound("官方资产文件不存在")
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) officialAssetView(asset *model.OfficialAsset, favorite bool, materialized bool, useCount int64, favoriteCount int64) (OfficialAssetView, error) {
	media := make([]OfficialAssetMediaView, 0, len(asset.Media))
	for _, item := range asset.Media {
		resource, err := s.repo.Resource(item.ResourceID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return OfficialAssetView{}, err
		}
		media = append(media, OfficialAssetMediaView{ID: item.ID, Role: item.Role, Position: item.Position, FileURL: officialAssetMediaFileURL(asset.ID, item.ID), Kind: resource.Kind, MimeType: resource.MimeType, Size: resource.Size, Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs})
	}
	return OfficialAssetView{
		ID: asset.ID, Title: asset.Title, Kind: asset.Kind, Category: asset.Category, Status: asset.Status,
		Description: asset.Description, Prompt: asset.Prompt, Tags: officialAssetTags(asset.TagsJSON), Source: asset.Source,
		License: asset.License, AIGenerated: asset.AIGenerated, SortOrder: asset.SortOrder, Favorite: favorite,
		Materialized: materialized, UseCount: useCount, FavoriteCount: favoriteCount, Media: media,
		CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt,
	}, nil
}

func officialAssetMediaFileURL(assetID string, mediaID string) string {
	return "/api/official-assets/" + assetID + "/media/" + mediaID + "/file"
}

func officialAssetTags(raw string) []string {
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil || tags == nil {
		return []string{}
	}
	return tags
}
