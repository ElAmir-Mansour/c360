package handler

import (
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/clario360/platform/internal/auth"
	datamw "github.com/clario360/platform/internal/data/middleware"
	"github.com/clario360/platform/internal/middleware"
)

func RegisterRoutes(
	r chi.Router,
	sourceHandler *SourceHandler,
	modelHandler *ModelHandler,
	pipelineHandler *PipelineHandler,
	qualityHandler *QualityHandler,
	contradictionHandler *ContradictionHandler,
	lineageHandler *LineageHandler,
	darkDataHandler *DarkDataHandler,
	analyticsHandler *AnalyticsHandler,
	dashboardHandler *DashboardHandler,
	jwtMgr *auth.JWTManager,
	rdb *redis.Client,
) {
	r.Route("/api/v1/data", func(r chi.Router) {
		r.Use(middleware.Auth(jwtMgr))
		r.Use(middleware.Tenant)
		r.Use(datamw.RateLimiter(rdb))

		// RBAC: GET endpoints require data:read; mutations require data:write.
		// Test-config / discover / sync trigger endpoints, and ad-hoc analytics
		// queries that scan the warehouse, are gated by data:write because they
		// reach into source systems.
		read := r.With(middleware.RequirePermission(auth.PermDataRead))
		write := r.With(middleware.RequirePermission(auth.PermDataWrite))

		read.Get("/source-types", sourceHandler.ListSourceTypes)
		read.Get("/source-types/{type}", sourceHandler.GetSourceType)
		read.Get("/sources/stats", sourceHandler.GetAggregateStats)
		write.Post("/sources/test-config", sourceHandler.TestConfig)
		write.Post("/sources", sourceHandler.Create)
		read.Get("/sources", sourceHandler.List)
		read.Get("/sources/{id}", sourceHandler.Get)
		write.Put("/sources/{id}", sourceHandler.Update)
		write.Delete("/sources/{id}", sourceHandler.Delete)
		write.Patch("/sources/{id}/status", sourceHandler.ChangeStatus)
		write.Post("/sources/{id}/test", sourceHandler.TestConnection)
		write.Post("/sources/{id}/discover", sourceHandler.Discover)
		read.Get("/sources/{id}/schema", sourceHandler.GetSchema)
		write.Post("/sources/{id}/sync", sourceHandler.TriggerSync)
		read.Get("/sources/{id}/sync-history", sourceHandler.ListSyncHistory)
		read.Get("/sources/{id}/stats", sourceHandler.GetStats)

		write.Post("/models", modelHandler.Create)
		read.Get("/models", modelHandler.List)
		write.Post("/models/derive", modelHandler.Derive)
		read.Get("/models/{id}", modelHandler.Get)
		write.Put("/models/{id}", modelHandler.Update)
		write.Delete("/models/{id}", modelHandler.Delete)
		write.Post("/models/{id}/validate", modelHandler.Validate)
		read.Get("/models/{id}/versions", modelHandler.Versions)
		write.Post("/models/{id}/versions", modelHandler.PublishVersion)
		read.Get("/models/{id}/lineage", modelHandler.Lineage)

		read.Get("/pipelines/stats", pipelineHandler.Stats)
		read.Get("/pipelines/count", pipelineHandler.Count)
		read.Get("/pipelines/active", pipelineHandler.Active)
		write.Post("/pipelines", pipelineHandler.Create)
		read.Get("/pipelines", pipelineHandler.List)
		read.Get("/pipelines/{id}", pipelineHandler.Get)
		write.Put("/pipelines/{id}", pipelineHandler.Update)
		write.Delete("/pipelines/{id}", pipelineHandler.Delete)
		write.Post("/pipelines/{id}/run", pipelineHandler.Run)
		write.Post("/pipelines/{id}/pause", pipelineHandler.Pause)
		write.Post("/pipelines/{id}/resume", pipelineHandler.Resume)
		read.Get("/pipelines/{id}/runs", pipelineHandler.ListRuns)
		read.Get("/pipelines/{id}/runs/{runId}", pipelineHandler.GetRun)
		read.Get("/pipelines/{id}/runs/{runId}/logs", pipelineHandler.GetRunLogs)

		read.Get("/quality/score/trend", qualityHandler.Trend)
		read.Get("/quality/score", qualityHandler.Score)
		read.Get("/quality/dashboard", qualityHandler.Dashboard)
		write.Post("/quality/rules", qualityHandler.CreateRule)
		read.Get("/quality/rules", qualityHandler.ListRules)
		read.Get("/quality/rules/{id}", qualityHandler.GetRule)
		write.Put("/quality/rules/{id}", qualityHandler.UpdateRule)
		write.Delete("/quality/rules/{id}", qualityHandler.DeleteRule)
		write.Post("/quality/rules/{id}/run", qualityHandler.RunRule)
		read.Get("/quality/results", qualityHandler.ListResults)
		read.Get("/quality/results/{id}", qualityHandler.GetResult)

		write.Post("/contradictions/scan", contradictionHandler.Scan)
		read.Get("/contradictions/scans", contradictionHandler.ListScans)
		read.Get("/contradictions/scans/{id}", contradictionHandler.GetScan)
		read.Get("/contradictions/stats", contradictionHandler.Stats)
		read.Get("/contradictions/dashboard", contradictionHandler.Dashboard)
		read.Get("/contradictions", contradictionHandler.List)
		read.Get("/contradictions/{id}", contradictionHandler.Get)
		write.Put("/contradictions/{id}/status", contradictionHandler.UpdateStatus)
		write.Post("/contradictions/{id}/resolve", contradictionHandler.Resolve)

		read.Get("/lineage/graph", lineageHandler.FullGraph)
		read.Get("/lineage/graph/{entityType}/{entityId}", lineageHandler.EntityGraph)
		read.Get("/lineage/upstream/{entityType}/{entityId}", lineageHandler.Upstream)
		read.Get("/lineage/downstream/{entityType}/{entityId}", lineageHandler.Downstream)
		read.Get("/lineage/impact/{entityType}/{entityId}", lineageHandler.Impact)
		write.Post("/lineage/record", lineageHandler.Record)
		write.Delete("/lineage/edges/{id}", lineageHandler.DeleteEdge)
		read.Get("/lineage/search", lineageHandler.Search)
		read.Get("/lineage/stats", lineageHandler.Stats)

		write.Post("/dark-data/scan", darkDataHandler.Scan)
		read.Get("/dark-data/scans", darkDataHandler.ListScans)
		read.Get("/dark-data/scans/{id}", darkDataHandler.GetScan)
		read.Get("/dark-data/stats", darkDataHandler.Stats)
		read.Get("/dark-data/dashboard", darkDataHandler.Dashboard)
		read.Get("/dark-data", darkDataHandler.ListAssets)
		read.Get("/dark-data/{id}", darkDataHandler.GetAsset)
		write.Put("/dark-data/{id}/status", darkDataHandler.UpdateStatus)
		write.Post("/dark-data/{id}/govern", darkDataHandler.Govern)

		write.Post("/analytics/query", analyticsHandler.Execute)
		write.Post("/analytics/explore/{modelId}", analyticsHandler.Explore)
		write.Post("/analytics/explain", analyticsHandler.Explain)
		read.Get("/analytics/saved", analyticsHandler.ListSaved)
		write.Post("/analytics/saved", analyticsHandler.CreateSaved)
		read.Get("/analytics/saved/{id}", analyticsHandler.GetSaved)
		write.Put("/analytics/saved/{id}", analyticsHandler.UpdateSaved)
		write.Delete("/analytics/saved/{id}", analyticsHandler.DeleteSaved)
		write.Post("/analytics/saved/{id}/run", analyticsHandler.RunSaved)
		read.Get("/analytics/audit", analyticsHandler.Audit)

		read.Get("/dashboard", dashboardHandler.Get)
	})
}
