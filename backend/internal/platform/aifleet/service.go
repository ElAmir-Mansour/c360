// Package aifleet provides the cross-tenant (fleet) rollup of AI governance for
// the platform admin console (screen 8, gap G23). AI governance itself is hosted
// inside iam-service and is single-tenant/RLS-locked per the JWT tenant; this
// package iterates every active tenant (reusing the aigovernance repositories
// under each tenant's RLS context) and aggregates the result. It is additive and
// does not change any existing single-tenant aigovernance route.
package aifleet

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	aigovmodel "github.com/clario360/platform/internal/aigovernance/model"
	aigovrepo "github.com/clario360/platform/internal/aigovernance/repository"
	aigovservice "github.com/clario360/platform/internal/aigovernance/service"
)

// FleetKPIs is the headline rollup across the whole estate.
type FleetKPIs struct {
	TotalTenants   int   `json:"total_tenants"`
	TotalModels    int   `json:"total_models"`
	InProduction   int   `json:"in_production"`
	ShadowTesting  int   `json:"shadow_testing"`
	Predictions24h int64 `json:"predictions_24h"`
	DriftAlerts    int   `json:"drift_alerts"`
}

// SuiteRollup aggregates per-suite across all tenants.
type SuiteRollup struct {
	Suite       aigovmodel.ModelSuite `json:"suite"`
	Models      int                   `json:"models"`
	DriftAlerts int                   `json:"drift_alerts"`
}

// TenantRollup is one row of the per-tenant drift-health table.
type TenantRollup struct {
	TenantID           uuid.UUID             `json:"tenant_id"`
	TenantName         string                `json:"tenant_name"`
	TenantSlug         string                `json:"tenant_slug"`
	SubscriptionTier   string                `json:"subscription_tier"`
	ModelCount         int                   `json:"model_count"`
	ProductionVersions int                   `json:"production_versions"`
	ShadowVersions     int                   `json:"shadow_versions"`
	Predictions24h     int64                 `json:"predictions_24h"`
	OpenDriftAlerts    int                   `json:"open_drift_alerts"`
	WorstDriftLevel    aigovmodel.DriftLevel `json:"worst_drift_level"`
	LastPredictionAt   *time.Time            `json:"last_prediction_at,omitempty"`
}

// FleetData is the response for GET /admin/ai/fleet/models.
type FleetData struct {
	KPIs    FleetKPIs      `json:"kpis"`
	BySuite []SuiteRollup  `json:"by_suite"`
	Tenants []TenantRollup `json:"tenants"`
}

// ModelTenantRow is one tenant's view of a single model slug.
type ModelTenantRow struct {
	TenantID          uuid.UUID                `json:"tenant_id"`
	TenantName        string                   `json:"tenant_name"`
	TenantSlug        string                   `json:"tenant_slug"`
	SubscriptionTier  string                   `json:"subscription_tier"`
	ModelID           uuid.UUID                `json:"model_id"`
	Name              string                   `json:"name"`
	Slug              string                   `json:"slug"`
	Suite             aigovmodel.ModelSuite    `json:"suite"`
	Type              aigovmodel.ModelType     `json:"type"`
	RiskTier          aigovmodel.RiskTier      `json:"risk_tier"`
	Status            aigovmodel.ModelStatus   `json:"status"`
	ProductionVersion *aigovmodel.ModelVersion `json:"production_version,omitempty"`
	ShadowVersion     *aigovmodel.ModelVersion `json:"shadow_version,omitempty"`
	Predictions24h    int64                    `json:"predictions_24h"`
	AvgConfidence     *float64                 `json:"avg_confidence,omitempty"`
	DriftStatus       aigovmodel.DriftLevel    `json:"drift_status"`
}

// ModelDrillDown is the response for GET /admin/ai/fleet/models/{slug}.
type ModelDrillDown struct {
	Slug    string           `json:"slug"`
	Tenants []ModelTenantRow `json:"tenants"`
}

// FleetFilters narrow the rollup. Empty fields are ignored.
type FleetFilters struct {
	Suite    string
	Drift    string
	RiskTier string
	Page     int
	PerPage  int
}

// Service computes the cross-tenant AI governance rollup by fanning out the
// existing single-tenant aigovernance repositories/service over every tenant.
type Service struct {
	fleetRepo      *aigovrepo.FleetRepository
	registryRepo   *aigovrepo.ModelRegistryRepository
	predictionRepo *aigovrepo.PredictionLogRepository
	driftRepo      *aigovrepo.DriftReportRepository
	dashboardSvc   *aigovservice.DashboardService
	logger         zerolog.Logger
}

func NewService(
	fleetRepo *aigovrepo.FleetRepository,
	registryRepo *aigovrepo.ModelRegistryRepository,
	predictionRepo *aigovrepo.PredictionLogRepository,
	driftRepo *aigovrepo.DriftReportRepository,
	dashboardSvc *aigovservice.DashboardService,
	logger zerolog.Logger,
) *Service {
	return &Service{
		fleetRepo:      fleetRepo,
		registryRepo:   registryRepo,
		predictionRepo: predictionRepo,
		driftRepo:      driftRepo,
		dashboardSvc:   dashboardSvc,
		logger:         logger.With().Str("component", "ai_fleet_service").Logger(),
	}
}

// driftRank orders drift levels so the "worst" can be computed.
func driftRank(level aigovmodel.DriftLevel) int {
	switch level {
	case aigovmodel.DriftLevelSignificant:
		return 3
	case aigovmodel.DriftLevelModerate:
		return 2
	case aigovmodel.DriftLevelLow:
		return 1
	default:
		return 0
	}
}

func matchesDriftFilter(filter string, level aigovmodel.DriftLevel) bool {
	if filter == "" {
		return true
	}
	return string(level) == filter
}

// Fleet aggregates the per-tenant AI dashboards into the fleet rollup. It reuses
// DashboardService.Get under each tenant's RLS context so the per-model
// production/shadow/drift/prediction logic stays identical to the single-tenant
// screen. One tenant's failure aborts the request (the console treats a 500 as
// "rollup unavailable"); per-tenant scrape errors are not modelled here.
func (s *Service) Fleet(ctx context.Context, f FleetFilters) (*FleetData, error) {
	tenants, err := s.fleetRepo.ListTenants(ctx)
	if err != nil {
		return nil, err
	}

	out := &FleetData{
		Tenants: make([]TenantRollup, 0, len(tenants)),
	}
	out.KPIs.TotalTenants = len(tenants)

	suiteIdx := make(map[aigovmodel.ModelSuite]*SuiteRollup)

	for _, t := range tenants {
		data, err := s.dashboardSvc.Get(ctx, t.ID)
		if err != nil {
			return nil, err
		}

		row := TenantRollup{
			TenantID:         t.ID,
			TenantName:       t.Name,
			TenantSlug:       t.Slug,
			SubscriptionTier: t.SubscriptionTier,
		}

		for _, m := range data.Models {
			// Apply optional filters at the model level.
			if f.Suite != "" && string(m.Suite) != f.Suite {
				continue
			}
			if f.RiskTier != "" && string(m.RiskTier) != f.RiskTier {
				continue
			}
			if !matchesDriftFilter(f.Drift, m.DriftStatus) {
				continue
			}

			row.ModelCount++
			out.KPIs.TotalModels++

			if m.ProductionVersion != nil {
				row.ProductionVersions++
				out.KPIs.InProduction++
			}
			if m.ShadowVersion != nil {
				row.ShadowVersions++
				out.KPIs.ShadowTesting++
			}
			row.Predictions24h += m.Predictions24h
			out.KPIs.Predictions24h += m.Predictions24h

			// by_suite rollup.
			sr, ok := suiteIdx[m.Suite]
			if !ok {
				sr = &SuiteRollup{Suite: m.Suite}
				suiteIdx[m.Suite] = sr
			}
			sr.Models++

			if driftRank(m.DriftStatus) > driftRank(row.WorstDriftLevel) {
				row.WorstDriftLevel = m.DriftStatus
			}
		}

		// open_drift_alerts and total drift alerts come from the per-tenant KPI,
		// which counts AlertCount across the tenant's latest drift reports.
		row.OpenDriftAlerts = data.KPIs.DriftAlerts
		out.KPIs.DriftAlerts += data.KPIs.DriftAlerts

		// Distribute the tenant's drift-alert count across the suites it owns so
		// the by_suite table carries a drift signal too.
		if data.KPIs.DriftAlerts > 0 {
			for _, m := range data.Models {
				if sr, ok := suiteIdx[m.Suite]; ok && m.DriftStatus != aigovmodel.DriftLevelNone && m.DriftStatus != "" {
					sr.DriftAlerts++
				}
			}
		}

		if row.WorstDriftLevel == "" {
			row.WorstDriftLevel = aigovmodel.DriftLevelNone
		}

		last, err := s.fleetRepo.LastPredictionAt(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		row.LastPredictionAt = last

		out.Tenants = append(out.Tenants, row)
	}

	out.BySuite = make([]SuiteRollup, 0, len(suiteIdx))
	for _, sr := range suiteIdx {
		out.BySuite = append(out.BySuite, *sr)
	}
	sort.Slice(out.BySuite, func(i, j int) bool {
		return out.BySuite[i].Suite < out.BySuite[j].Suite
	})

	// Optional pagination over the tenant rollup rows. KPIs and by_suite remain
	// estate-wide (they describe the whole fleet, not the current page).
	if f.Page > 0 && f.PerPage > 0 {
		start := (f.Page - 1) * f.PerPage
		if start >= len(out.Tenants) {
			out.Tenants = []TenantRollup{}
		} else {
			end := start + f.PerPage
			if end > len(out.Tenants) {
				end = len(out.Tenants)
			}
			out.Tenants = out.Tenants[start:end]
		}
	}

	return out, nil
}

// Model returns the per-tenant drill-down for one model slug. Tenants that have
// no model with that slug are omitted.
func (s *Service) Model(ctx context.Context, slug string) (*ModelDrillDown, error) {
	tenants, err := s.fleetRepo.ListTenants(ctx)
	if err != nil {
		return nil, err
	}

	out := &ModelDrillDown{
		Slug:    slug,
		Tenants: make([]ModelTenantRow, 0, len(tenants)),
	}
	since := time.Now().UTC().Add(-24 * time.Hour)

	for _, t := range tenants {
		model, err := s.registryRepo.GetModelBySlug(ctx, t.ID, slug)
		if err != nil {
			if isNotFound(err) {
				continue
			}
			return nil, err
		}

		row := ModelTenantRow{
			TenantID:         t.ID,
			TenantName:       t.Name,
			TenantSlug:       t.Slug,
			SubscriptionTier: t.SubscriptionTier,
			ModelID:          model.ID,
			Name:             model.Name,
			Slug:             model.Slug,
			Suite:            model.Suite,
			Type:             model.ModelType,
			RiskTier:         model.RiskTier,
			Status:           model.Status,
			DriftStatus:      aigovmodel.DriftLevelNone,
		}

		if prod, err := s.registryRepo.GetCurrentProductionVersion(ctx, t.ID, model.ID); err == nil {
			row.ProductionVersion = prod
		}
		if shadow, err := s.registryRepo.GetCurrentShadowVersion(ctx, t.ID, model.ID); err == nil {
			row.ShadowVersion = shadow
		}
		if stats, err := s.predictionRepo.RecentModelStats(ctx, t.ID, since); err == nil {
			if stat, ok := stats[model.ID]; ok {
				row.Predictions24h = stat.Predictions24h
				row.AvgConfidence = stat.AvgConfidence
			}
		}
		if drift, err := s.driftRepo.LatestByModel(ctx, t.ID, model.ID); err == nil {
			row.DriftStatus = drift.OutputDriftLevel
		}

		out.Tenants = append(out.Tenants, row)
	}

	return out, nil
}

// TenantSummary returns the existing per-tenant DashboardData shape, addressed by
// tenant id. The caller (super-admin) is responsible for the RBAC gate; this
// method sets the tenant context (via DashboardService.Get → RLS) to {id} and
// returns the same payload the single-tenant /ai/dashboard route produces.
func (s *Service) TenantSummary(ctx context.Context, tenantID uuid.UUID) (*aigovservice.DashboardData, error) {
	if _, err := s.fleetRepo.GetTenant(ctx, tenantID); err != nil {
		return nil, err
	}
	return s.dashboardSvc.Get(ctx, tenantID)
}

func isNotFound(err error) bool {
	return errors.Is(err, aigovrepo.ErrNotFound)
}
