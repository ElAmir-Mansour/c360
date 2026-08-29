package handler

import (
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/clario360/platform/internal/auth"
	cyberhealth "github.com/clario360/platform/internal/cyber/health"
	cybermw "github.com/clario360/platform/internal/cyber/middleware"
	uebahandler "github.com/clario360/platform/internal/cyber/ueba/handler"
	"github.com/clario360/platform/internal/middleware"
)

// RegisterRoutes mounts all cyber service routes on the given router.
// All routes require a valid JWT; tenant isolation is enforced by the Auth
// middleware. Mutations require cyber:write; reads require cyber:read.
func RegisterRoutes(
	r chi.Router,
	assetHandler *AssetHandler,
	alertHandler *AlertHandler,
	ruleHandler *RuleHandler,
	threatHandler *ThreatHandler,
	threatFeedHandler *ThreatFeedHandler,
	mitreHandler *MITREHandler,
	ctemHandler *CTEMHandler,
	ctemReportHandler *CTEMReportHandler,
	riskHandler *RiskHandler,
	dashboardHandler *DashboardHandler,
	vulnerabilityHandler *VulnerabilityHandler,
	remediationHandler *RemediationHandler,
	dspmHandler *DSPMHandler,
	uebaHandler *uebahandler.UEBAHandler,
	eventHandler *EventHandler,
	analyticsHandler *AnalyticsHandler,
	jwtMgr *auth.JWTManager,
	rdb *redis.Client,
	extraRoutes ...func(chi.Router),
) {
	cyberhealth.Register(r)

	r.Route("/api/v1/cyber", func(r chi.Router) {
		r.Use(middleware.Auth(jwtMgr))
		r.Use(middleware.Tenant)
		r.Use(cybermw.RateLimiter(rdb, 1200, assetHandler.logger))

		// RBAC: GET → cyber:read; mutations and async-trigger endpoints (scan,
		// execute, dry-run, mobilize, calculate) → cyber:write. Recompute /
		// recalculate endpoints are also writes because they enqueue work.
		read := r.With(middleware.RequirePermission(auth.PermCyberRead))
		write := r.With(middleware.RequirePermission(auth.PermCyberWrite))

		// ---- Statistics ----
		read.Get("/assets/stats", assetHandler.GetStats)
		read.Get("/assets/count", assetHandler.GetCount)

		// ---- Scan endpoints (listed before /{id} to avoid ambiguity) ----
		write.Post("/assets/scan", assetHandler.TriggerScan)
		read.Get("/assets/scans", assetHandler.ListScans)
		read.Get("/assets/scans/{id}", assetHandler.GetScan)
		write.Post("/assets/scans/{id}/cancel", assetHandler.CancelScan)

		// ---- Bulk operations ----
		write.Post("/assets/bulk", assetHandler.BulkCreate)
		write.Put("/assets/bulk/tags", assetHandler.BulkUpdateTags)
		write.Delete("/assets/bulk", assetHandler.BulkDelete)

		// ---- Asset CRUD ----
		write.Post("/assets", assetHandler.CreateAsset)
		read.Get("/assets", assetHandler.ListAssets)
		read.Get("/assets/{id}", assetHandler.GetAsset)
		write.Put("/assets/{id}", assetHandler.UpdateAsset)
		write.Delete("/assets/{id}", assetHandler.DeleteAsset)
		write.Patch("/assets/{id}/tags", assetHandler.PatchTags)

		// ---- Activity ----
		read.Get("/assets/{id}/activity", assetHandler.ListActivity)

		// ---- Relationships ----
		read.Get("/assets/{id}/relationships", assetHandler.ListRelationships)
		write.Post("/assets/{id}/relationships", assetHandler.CreateRelationship)
		write.Delete("/assets/{id}/relationships/{relId}", assetHandler.DeleteRelationship)

		// ---- Vulnerabilities ----
		read.Get("/assets/{id}/vulnerabilities", assetHandler.ListVulnerabilities)
		write.Post("/assets/{id}/vulnerabilities", assetHandler.CreateVulnerability)
		write.Put("/assets/{id}/vulnerabilities/{vid}", assetHandler.UpdateVulnerability)

		// ---- Alerts ----
		write.Put("/alerts/bulk/status", alertHandler.BulkUpdateStatus)
		write.Put("/alerts/bulk/assign", alertHandler.BulkAssign)
		write.Put("/alerts/bulk/false-positive", alertHandler.BulkMarkFalsePositive)
		read.Get("/alerts/stats", alertHandler.Stats)
		read.Get("/alerts/count", alertHandler.Count)
		read.Get("/alerts/{id}/comments", alertHandler.ListComments)
		read.Get("/alerts/{id}/timeline", alertHandler.ListTimeline)
		read.Get("/alerts/{id}/related", alertHandler.Related)
		read.Get("/alerts/{id}", alertHandler.GetAlert)
		read.Get("/alerts", alertHandler.ListAlerts)
		write.Put("/alerts/{id}/status", alertHandler.UpdateStatus)
		write.Put("/alerts/{id}/false-positive", alertHandler.MarkFalsePositive)
		write.Put("/alerts/{id}/assign", alertHandler.Assign)
		write.Post("/alerts/{id}/escalate", alertHandler.Escalate)
		write.Post("/alerts/{id}/comment", alertHandler.AddComment)
		write.Post("/alerts/{id}/comments", alertHandler.AddComment)
		write.Post("/alerts/{id}/merge", alertHandler.Merge)

		// ---- Detection Rules ----
		read.Get("/rules/stats", ruleHandler.Stats)
		read.Get("/rules/templates", ruleHandler.ListTemplates)
		read.Get("/rules/{id}/performance", ruleHandler.Performance)
		read.Get("/rules/{id}", ruleHandler.GetRule)
		read.Get("/rules", ruleHandler.ListRules)
		write.Post("/rules", ruleHandler.CreateRule)
		write.Put("/rules/{id}", ruleHandler.UpdateRule)
		write.Delete("/rules/{id}", ruleHandler.DeleteRule)
		write.Put("/rules/{id}/toggle", ruleHandler.Toggle)
		write.Post("/rules/{id}/test", ruleHandler.TestRule)
		write.Post("/rules/{id}/feedback", ruleHandler.Feedback)

		// ---- Threats & Indicators ----
		read.Get("/threats/stats", threatHandler.Stats)
		read.Get("/threats/stats/trend", threatHandler.Trend)
		write.Post("/threats", threatHandler.CreateThreat)
		read.Get("/threats/{id}/indicators", threatHandler.ListIndicatorsForThreat)
		write.Post("/threats/{id}/indicators", threatHandler.AddIndicatorToThreat)
		write.Put("/indicators/{indicatorId}/status", threatHandler.UpdateIndicatorStatus)
		read.Get("/threats/{id}/alerts", threatHandler.RelatedAlerts)
		read.Get("/threats/{id}/timeline", threatHandler.Timeline)
		read.Get("/threats/{id}", threatHandler.GetThreat)
		write.Put("/threats/{id}", threatHandler.UpdateThreat)
		write.Delete("/threats/{id}", threatHandler.DeleteThreat)
		read.Get("/threats", threatHandler.ListThreats)
		write.Put("/threats/{id}/status", threatHandler.UpdateStatus)
		write.Post("/indicators/check", threatHandler.CheckIndicators)
		write.Post("/indicators/bulk", threatHandler.BulkImportIndicators)
		write.Post("/indicators/batch", threatHandler.BatchCreateIndicators)
		read.Get("/indicators/stats", threatHandler.IndicatorStats)
		write.Post("/indicators", threatHandler.CreateIndicator)
		read.Get("/indicators", threatHandler.ListIndicators)
		read.Get("/indicators/{indicatorId}", threatHandler.GetIndicator)
		write.Put("/indicators/{indicatorId}", threatHandler.UpdateIndicator)
		write.Delete("/indicators/{indicatorId}", threatHandler.DeleteIndicator)
		read.Get("/indicators/{indicatorId}/enrichment", threatHandler.IndicatorEnrichment)
		read.Get("/indicators/{indicatorId}/matches", threatHandler.IndicatorMatches)

		// ---- Threat Feeds ----
		if threatFeedHandler != nil {
			read.Get("/threat-feeds", threatFeedHandler.List)
			write.Post("/threat-feeds", threatFeedHandler.Create)
			read.Get("/threat-feeds/{feedId}", threatFeedHandler.Get)
			write.Put("/threat-feeds/{feedId}", threatFeedHandler.Update)
			write.Delete("/threat-feeds/{feedId}", threatFeedHandler.Delete)
			write.Post("/threat-feeds/{feedId}/sync", threatFeedHandler.Sync)
			read.Get("/threat-feeds/{feedId}/history", threatFeedHandler.History)
		}

		// ---- MITRE ATT&CK ----
		read.Get("/mitre/tactics", mitreHandler.ListTactics)
		read.Get("/mitre/techniques/{id}", mitreHandler.GetTechnique)
		read.Get("/mitre/techniques", mitreHandler.ListTechniques)
		read.Get("/mitre/coverage", mitreHandler.Coverage)
		read.Get("/mitre/framework-meta", mitreHandler.FrameworkMeta)

		if vulnerabilityHandler != nil {
			read.Get("/vulnerabilities/stats", vulnerabilityHandler.Stats)
			read.Get("/vulnerabilities/aging", vulnerabilityHandler.Aging)
			read.Get("/vulnerabilities/top-cves", vulnerabilityHandler.TopCVEs)
			read.Get("/vulnerabilities/{id}", vulnerabilityHandler.Get)
			read.Get("/vulnerabilities", vulnerabilityHandler.List)
			write.Put("/vulnerabilities/{id}/status", vulnerabilityHandler.UpdateStatus)
		}

		if riskHandler != nil {
			read.Get("/risk/score", riskHandler.GetScore)
			read.Get("/risk/score/trend", riskHandler.GetTrend)
			// Recalculate enqueues a recompute job — write permission.
			write.Get("/risk/score/recalculate", riskHandler.Recalculate)
			read.Get("/risk/heatmap", riskHandler.GetHeatmap)
			read.Get("/risk/top-risks", riskHandler.GetTopRisks)
			read.Get("/risk/recommendations", riskHandler.GetRecommendations)
		}

		if dashboardHandler != nil {
			read.Get("/dashboard", dashboardHandler.GetDashboard)
			read.Get("/dashboard/kpis", dashboardHandler.GetKPIs)
			read.Get("/dashboard/metrics", dashboardHandler.GetMetrics)
			read.Get("/dashboard/alerts-timeline", dashboardHandler.GetAlertsTimeline)
			read.Get("/dashboard/severity-distribution", dashboardHandler.GetSeverityDistribution)
			read.Get("/dashboard/mttr", dashboardHandler.GetMTTR)
			read.Get("/dashboard/analyst-workload", dashboardHandler.GetAnalystWorkload)
			read.Get("/dashboard/top-attacked-assets", dashboardHandler.GetTopAttackedAssets)
			read.Get("/dashboard/mitre-heatmap", dashboardHandler.GetMITREHeatmap)
			read.Get("/dashboard/trends", dashboardHandler.GetTrends)
		}

		if remediationHandler != nil {
			read.Get("/remediation/stats", remediationHandler.Stats)
			write.Post("/remediation", remediationHandler.Create)
			read.Get("/remediation", remediationHandler.List)
			read.Get("/remediation/{id}", remediationHandler.Get)
			write.Put("/remediation/{id}", remediationHandler.Update)
			write.Delete("/remediation/{id}", remediationHandler.Delete)
			write.Post("/remediation/{id}/submit", remediationHandler.Submit)
			write.Post("/remediation/{id}/approve", remediationHandler.Approve)
			write.Post("/remediation/{id}/reject", remediationHandler.Reject)
			write.Post("/remediation/{id}/request-revision", remediationHandler.RequestRevision)
			write.Post("/remediation/{id}/dry-run", remediationHandler.DryRun)
			read.Get("/remediation/{id}/dry-run", remediationHandler.GetDryRun)
			write.Post("/remediation/{id}/execute", remediationHandler.Execute)
			write.Post("/remediation/{id}/verify", remediationHandler.Verify)
			write.Post("/remediation/{id}/rollback", remediationHandler.Rollback)
			write.Post("/remediation/{id}/close", remediationHandler.Close)
			read.Get("/remediation/{id}/audit-trail", remediationHandler.AuditTrail)
		}

		if dspmHandler != nil {
			read.Get("/dspm/data-assets", dspmHandler.ListDataAssets)
			read.Get("/dspm/data-assets/{id}", dspmHandler.GetDataAsset)
			write.Post("/dspm/scan", dspmHandler.TriggerScan)
			read.Get("/dspm/scans", dspmHandler.ListScans)
			read.Get("/dspm/scans/{id}", dspmHandler.GetScan)
			read.Get("/dspm/classification", dspmHandler.Classification)
			read.Get("/dspm/exposure", dspmHandler.Exposure)
			read.Get("/dspm/dependencies", dspmHandler.Dependencies)
			read.Get("/dspm/dashboard", dspmHandler.Dashboard)
			read.Get("/dspm/shadow-copies", dspmHandler.DetectShadowCopies)
		}

		uebahandler.RegisterRoutes(r, uebaHandler)

		// ---- Security Events ----
		if eventHandler != nil {
			read.Get("/events/stats", eventHandler.GetEventStats)
			read.Get("/events/export", eventHandler.ExportEvents)
			read.Get("/events/{id}", eventHandler.GetEvent)
			read.Get("/events", eventHandler.ListEvents)
			write.Post("/events", eventHandler.IngestEvents)
		}

		// ---- Analytics ----
		if analyticsHandler != nil {
			read.Get("/analytics/threat-forecast", analyticsHandler.ThreatForecast)
			read.Get("/analytics/alert-forecast", analyticsHandler.AlertForecast)
			read.Get("/analytics/technique-trends", analyticsHandler.TechniqueTrends)
			read.Get("/analytics/campaigns", analyticsHandler.Campaigns)
			read.Get("/analytics/landscape", analyticsHandler.Landscape)
		}

		if ctemHandler != nil && ctemReportHandler != nil {
			r.Route("/ctem", func(r chi.Router) {
				cread := r.With(middleware.RequirePermission(auth.PermCyberRead))
				cwrite := r.With(middleware.RequirePermission(auth.PermCyberWrite))

				cwrite.Post("/assessments", ctemHandler.CreateAssessment)
				cread.Get("/assessments", ctemHandler.ListAssessments)
				cread.Get("/dashboard", ctemHandler.Dashboard)
				cread.Get("/exposure-score", ctemHandler.GetExposureScore)
				cread.Get("/exposure-score/history", ctemHandler.GetExposureScoreHistory)
				cwrite.Post("/exposure-score/calculate", ctemHandler.ForceCalculateExposureScore)

				cread.Get("/findings/{findingId}", ctemHandler.GetFinding)
				cwrite.Put("/findings/{findingId}/status", ctemHandler.UpdateFindingStatus)

				cread.Get("/remediation-groups/{groupId}", ctemHandler.GetRemediationGroup)
				cwrite.Put("/remediation-groups/{groupId}/status", ctemHandler.UpdateRemediationGroupStatus)
				cwrite.Post("/remediation-groups/{groupId}/execute", ctemHandler.ExecuteRemediationGroup)

				cread.Get("/assessments/{id}", ctemHandler.GetAssessment)
				cwrite.Put("/assessments/{id}", ctemHandler.UpdateAssessment)
				cwrite.Post("/assessments/{id}/start", ctemHandler.StartAssessment)
				cwrite.Post("/assessments/{id}/cancel", ctemHandler.CancelAssessment)
				cwrite.Delete("/assessments/{id}", ctemHandler.DeleteAssessment)

				cread.Get("/assessments/{id}/scope", ctemHandler.GetScope)
				cread.Get("/assessments/{id}/discovery", ctemHandler.GetDiscovery)
				cread.Get("/assessments/{id}/priorities", ctemHandler.GetPriorities)
				cwrite.Post("/assessments/{id}/validate", ctemHandler.ValidateAssessment)
				cread.Get("/assessments/{id}/validation", ctemHandler.GetValidation)
				cwrite.Post("/assessments/{id}/mobilize", ctemHandler.MobilizeAssessment)
				cread.Get("/assessments/{id}/mobilization", ctemHandler.GetMobilization)
				cread.Get("/assessments/{id}/findings", ctemHandler.ListFindings)
				cread.Get("/assessments/{id}/remediation-groups", ctemHandler.ListRemediationGroups)
				cread.Get("/assessments/{id}/report", ctemReportHandler.GetReport)
				cread.Get("/assessments/{id}/report/executive", ctemReportHandler.GetExecutiveSummary)
				cwrite.Post("/assessments/{id}/report/export", ctemReportHandler.ExportReport)
				cread.Get("/assessments/{id}/compare/{otherId}", ctemHandler.CompareAssessments)
			})
		}

		// ---- Extra sub-module routes (DSPM intelligence, access, remediation) ----
		// Sub-modules register their own permission gates — see each module's routes.
		for _, fn := range extraRoutes {
			fn(r)
		}
	})
}
