package handler

import (
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// Reject skill requests before parsing uploads or fetching remote packages.
func requireSkillAdministration(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err == nil {
			err = svc.RequireSkillAdministrator(actor.ID)
		}
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	}
}

// Require an active session before accepting personal skill requests or reading uploads.
func requireSkillUser(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err == nil {
			err = svc.RequireSkillUser(actor.ID)
		}
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Next()
	}
}
