package handler

import (
	"io"
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterOfficialAssetRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/official-assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 36)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.OfficialAssets(user.ID, service.OfficialAssetQuery{
			Page: page, PageSize: pageSize, Keyword: c.Query("q"), Kind: c.Query("kind"), Category: c.Query("category"), FavoriteOnly: c.Query("favorite") == "1",
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/official-assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		asset, err := svc.OfficialAssetDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})

	r.PUT("/official-assets/:id/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.SetOfficialAssetFavorite(user.ID, c.Param("id"), true); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"favorite": true})
	})

	r.DELETE("/official-assets/:id/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.SetOfficialAssetFavorite(user.ID, c.Param("id"), false); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"favorite": false})
	})

	r.POST("/official-assets/:id/materialize", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		asset, err := svc.MaterializeOfficialAsset(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})

	r.GET("/official-assets/:id/media/:mediaId/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		stream, err := svc.OpenOfficialAssetMedia(user, c.Param("id"), c.Param("mediaId"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		mimeType := stream.Resource.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		c.Header("Content-Type", mimeType)
		c.Header("X-Content-Type-Options", "nosniff")
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		if stream.AcceptRanges != "" {
			c.Header("Accept-Ranges", stream.AcceptRanges)
		}
		if seeker, ok := stream.Body.(io.ReadSeeker); ok && stream.StatusCode == http.StatusOK {
			http.ServeContent(c.Writer, c.Request, stream.Resource.ID, stream.Resource.UpdatedAt, seeker)
			return
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
	})

	r.GET("/admin/official-assets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 30)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminOfficialAssets(actor, service.OfficialAssetQuery{Page: page, PageSize: pageSize, Keyword: c.Query("q"), Kind: c.Query("kind"), Category: c.Query("category"), Status: c.Query("status")})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/admin/official-assets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SaveOfficialAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.SaveOfficialAsset(actor, "", req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})

	r.PATCH("/admin/official-assets/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SaveOfficialAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.SaveOfficialAsset(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})

	r.PATCH("/admin/official-assets/:id/status", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		asset, err := svc.OfficialAssetDetail(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Status string `json:"status"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		updated, err := svc.SaveOfficialAsset(actor, asset.ID, service.SaveOfficialAssetRequest{
			Title: asset.Title, Category: asset.Category, Status: req.Status, Description: asset.Description,
			Prompt: asset.Prompt, Tags: asset.Tags, Source: asset.Source, License: asset.License, AIGenerated: asset.AIGenerated, SortOrder: asset.SortOrder,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": updated})
	})
}
