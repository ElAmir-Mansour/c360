package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ReportingService is the READ-mostly analytics service for Phase 4
// (CAP-133..151). Each report fans out its independent aggregate queries with an
// errgroup (mirroring DashboardService) and the consolidated legal-affairs
// dashboard is cached in Redis. Reports compute from the REAL source tables; the
// duration_fact store refines working-duration averages and is the preferred SLA
// outcome source for request-processing KPIs when facts are present.
type ReportingService struct {
	repo           *repository.ReportingRepository
	facts          *DurationFactService
	slaKPI         *SLAKPIService
	cases          *LegalCaseService
	investigations *InvestigationService
	redis          *redis.Client
	logger         zerolog.Logger
	cacheTTL       time.Duration
	now            func() time.Time
}

func NewReportingService(repo *repository.ReportingRepository, facts *DurationFactService, slaKPI *SLAKPIService, redisClient *redis.Client, logger zerolog.Logger, cacheTTL time.Duration) *ReportingService {
	if cacheTTL <= 0 {
		cacheTTL = 60 * time.Second
	}
	return &ReportingService{
		repo:     repo,
		facts:    facts,
		slaKPI:   slaKPI,
		redis:    redisClient,
		logger:   logger.With().Str("service", "lex-reporting").Logger(),
		cacheTTL: cacheTTL,
		now:      time.Now,
	}
}

// WithCaseControlSources wires the two existing domain services used for the
// compact recent/active rows on the consolidated control-panel endpoint. Using
// the investigation service is security-critical: its repository transparently
// decrypts PII fields rather than returning ciphertext from a reporting query.
func (s *ReportingService) WithCaseControlSources(cases *LegalCaseService, investigations *InvestigationService) *ReportingService {
	s.cases = cases
	s.investigations = investigations
	return s
}

// --- CASE report (CAP-133..138) --------------------------------------------

func (s *ReportingService) CaseReport(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.CaseReport, error) {
	rf := repository.NewReportFilter(filters)
	var (
		total          int
		byType         []model.CountBucket
		byDept         []model.CountBucket
		byStatus       []model.CountBucket
		byCompany      []model.CountBucket
		closed         int
		underProcedure int
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { total, err = s.repo.CaseTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byType, err = s.repo.CasesByType(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byDept, err = s.repo.CasesByDepartment(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byStatus, err = s.repo.CasesByStatus(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byCompany, err = s.repo.CasesByCompanyStatus(gctx, tenantID, rf); return })
	g.Go(func() (err error) { closed, err = s.repo.CaseStatusCount(gctx, tenantID, "closed", rf); return })
	g.Go(func() (err error) {
		underProcedure, err = s.repo.CaseStatusCount(gctx, tenantID, "under_procedure", rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build case report", err)
	}
	return &model.CaseReport{
		GeneratedAt:    s.now().UTC(),
		Filters:        filters,
		Total:          total,
		ByType:         byType,
		ByDepartment:   byDept,
		ByStatus:       byStatus,
		ByCompanyRole:  byCompany,
		Closed:         closed,
		UnderProcedure: underProcedure,
	}, nil
}

// --- INVESTIGATION report --------------------------------------------------

const investigationReportItemLimit = 200

func (s *ReportingService) InvestigationReport(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.InvestigationReport, error) {
	rf := repository.NewReportFilter(filters)
	generatedAt := s.now().UTC()
	var (
		summary    repository.InvestigationReportSummary
		byStatus   []model.CountBucket
		byCategory []model.CountBucket
		slaBuckets []model.CountBucket
		items      []model.InvestigationReportItem
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		summary, err = s.repo.InvestigationReportSummary(gctx, tenantID, generatedAt, rf)
		return
	})
	g.Go(func() (err error) { byStatus, err = s.repo.InvestigationsByStatus(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byCategory, err = s.repo.InvestigationsByCategory(gctx, tenantID, rf); return })
	g.Go(func() (err error) { slaBuckets, err = s.repo.InvestigationSLAOutcomes(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		items, err = s.repo.InvestigationReportItems(gctx, tenantID, generatedAt, investigationReportItemLimit, rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build investigation report", err)
	}
	return &model.InvestigationReport{
		GeneratedAt:                generatedAt,
		Filters:                    filters,
		Total:                      summary.Total,
		ByStatus:                   completeInvestigationStatusBuckets(byStatus),
		ByCategory:                 byCategory,
		Open:                       summary.Total - summary.Closed,
		Closed:                     summary.Closed,
		AvgOpenAgeDays:             round2(summary.AvgOpenAgeDays),
		AvgRegisterToApprovedHours: round2(summary.AvgRegisterToApprovedHours),
		ApprovalSampleSize:         summary.ApprovalSampleSize,
		SLA:                        investigationSLAReport(slaBuckets),
		Items:                      roundInvestigationReportItems(items),
		ItemsTruncated:             summary.Total > len(items),
	}, nil
}

func investigationSLAReport(buckets []model.CountBucket) model.InvestigationSLAReport {
	var report model.InvestigationSLAReport
	for _, bucket := range buckets {
		switch model.SLAClockOutcome(bucket.Key) {
		case model.SLAClockOutcomeOnTime:
			report.OnTime += bucket.Count
		case model.SLAClockOutcomeBreached:
			report.Breached += bucket.Count
		case model.SLAClockOutcomePending:
			report.Pending += bucket.Count
		}
	}
	resolved := report.OnTime + report.Breached
	if resolved > 0 {
		report.ComplianceRatePct = round2(float64(report.OnTime) / float64(resolved) * 100)
	}
	return report
}

func completeInvestigationStatusBuckets(buckets []model.CountBucket) []model.CountBucket {
	counts := make(map[string]int, len(buckets))
	for _, bucket := range buckets {
		counts[bucket.Key] += bucket.Count
	}
	statuses := []model.InvestigationStatus{
		model.InvestigationStatusRegistered,
		model.InvestigationStatusInProgress,
		model.InvestigationStatusResults,
		model.InvestigationStatusPendingApprove,
		model.InvestigationStatusApproved,
		model.InvestigationStatusRejected,
		model.InvestigationStatusClosed,
		model.InvestigationStatusCancelled,
	}
	out := make([]model.CountBucket, 0, len(statuses))
	for _, status := range statuses {
		out = append(out, model.CountBucket{Key: string(status), Count: counts[string(status)]})
	}
	return out
}

func roundInvestigationReportItems(items []model.InvestigationReportItem) []model.InvestigationReportItem {
	if items == nil {
		return []model.InvestigationReportItem{}
	}
	for i := range items {
		items[i].AgeDays = round2(items[i].AgeDays)
	}
	return items
}

// --- CONTRACT report (CAP-139..142) ----------------------------------------

func (s *ReportingService) ContractReport(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.ContractAnalyticsReport, error) {
	rf := repository.NewReportFilter(filters)
	var (
		total    int
		byDept   []model.CountBucket
		byType   []model.CountBucket
		byStatus []model.CountBucket
		avgHours float64
		sample   int
		// v2 additive aggregates (reports upgrade).
		spendByType     []model.ValueBucket
		spendByDept     []model.ValueBucket
		totalValue      float64
		valueByCurrency map[string]float64
		cliff           []model.ExpiryCliffPoint
		cycleAvg        float64
		cycleP50        float64
		cycleP90        float64
		cycleSample     int
	)
	// The expiry cliff is anchored on the month the report is generated in.
	cliffStart := monthStartUTC(s.now())
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { total, err = s.repo.ContractTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byDept, err = s.repo.ContractsByDepartment(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byType, err = s.repo.ContractsByType(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byStatus, err = s.repo.ContractsByStatus(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		avgHours, sample, err = s.repo.ContractReviewDuration(gctx, tenantID, rf)
		return
	})
	g.Go(func() (err error) {
		spendByType, err = s.repo.ContractValueByDimension(gctx, tenantID, "type", rf)
		return
	})
	g.Go(func() (err error) {
		spendByDept, err = s.repo.ContractValueByDimension(gctx, tenantID, "department", rf)
		return
	})
	g.Go(func() (err error) {
		totalValue, valueByCurrency, err = s.repo.ContractValueTotals(gctx, tenantID, rf)
		return
	})
	g.Go(func() (err error) {
		cliff, err = s.repo.ContractExpiryCliff(gctx, tenantID, cliffStart, contractExpiryCliffMonths, rf)
		return
	})
	g.Go(func() (err error) {
		cycleAvg, cycleP50, cycleP90, cycleSample, err = s.repo.ContractCycleTimeFromTimeline(gctx, tenantID, rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build contract report", err)
	}
	// Refine review duration with the working-calendar fact store when it has data.
	if s.facts != nil {
		if factHours, factSample, ferr := s.facts.AverageWorkingHours(ctx, tenantID, model.DurationFactContractReview, filters); ferr == nil && factSample > 0 {
			avgHours = factHours
			sample = factSample
		}
	}
	// Cycle time prefers the audit-event-derived fact store when populated
	// (same non-fatal refinement pattern as the review-duration average).
	cycle := contractCycleTimeStats(cycleAvg, cycleP50, cycleP90, cycleSample, model.CycleTimeSourceStatusTimeline)
	if factAvg, factP50, factP90, factSample, ferr := s.repo.ContractCycleTimeFromFacts(ctx, tenantID, rf); ferr == nil && factSample > 0 {
		cycle = contractCycleTimeStats(factAvg, factP50, factP90, factSample, model.CycleTimeSourceDurationFacts)
	}
	return &model.ContractAnalyticsReport{
		GeneratedAt:            s.now().UTC(),
		Filters:                filters,
		Total:                  total,
		AvgReviewDurationHours: round2(avgHours),
		ReviewSampleSize:       sample,
		ByDepartment:           byDept,
		ByType:                 byType,
		ByStatus:               byStatus,
		TotalValue:             round2(totalValue),
		TotalValueByCurrency:   roundCurrencyMap(valueByCurrency),
		SpendByType:            roundValueBuckets(spendByType),
		SpendByDepartment:      roundValueBuckets(spendByDept),
		ExpiryCliff:            fillExpiryCliff(cliff, cliffStart, contractExpiryCliffMonths),
		CycleTime:              cycle,
	}, nil
}

// --- CONSULTATION report (CAP-143..145) ------------------------------------

func (s *ReportingService) ConsultationReport(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.ConsultationReport, error) {
	rf := repository.NewReportFilter(filters)
	var (
		total    int
		byDept   []model.CountBucket
		byType   []model.CountBucket
		byStatus []model.CountBucket
		avgHours float64
		sample   int
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { total, err = s.repo.ConsultationTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byDept, err = s.repo.ConsultationsByDepartment(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byType, err = s.repo.ConsultationsByType(gctx, tenantID, rf); return })
	g.Go(func() (err error) { byStatus, err = s.repo.ConsultationsByStatus(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		avgHours, sample, err = s.repo.ConsultationCompletionDuration(gctx, tenantID, rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build consultation report", err)
	}
	if s.facts != nil {
		if factHours, factSample, ferr := s.facts.AverageWorkingHours(ctx, tenantID, model.DurationFactConsultationAnswer, filters); ferr == nil && factSample > 0 {
			avgHours = factHours
			sample = factSample
		}
	}
	return &model.ConsultationReport{
		GeneratedAt:            s.now().UTC(),
		Filters:                filters,
		Total:                  total,
		ByDepartment:           byDept,
		ByType:                 byType,
		ByStatus:               byStatus,
		AvgCompletionTimeHours: round2(avgHours),
		CompletionSampleSize:   sample,
	}, nil
}

// --- PERFORMANCE KPIs (CAP-146..150) ---------------------------------------

func (s *ReportingService) PerformanceKPIs(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.PerformanceKPIs, error) {
	rf := repository.NewReportFilter(filters)
	var (
		avgProcHours   float64
		procSample     int
		totalCases     int
		closedCases    int
		totalContracts int
		approved       int
		overdue        int
		resolved       int
		onTime         int
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		avgProcHours, procSample, err = s.repo.RequestProcessingDuration(gctx, tenantID, rf)
		return
	})
	g.Go(func() (err error) { totalCases, err = s.repo.CaseTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { closedCases, err = s.repo.CaseStatusCount(gctx, tenantID, "closed", rf); return })
	g.Go(func() (err error) { totalContracts, err = s.repo.ContractTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		approved, err = s.repo.ApprovedContractCount(gctx, tenantID, rf)
		return
	})
	g.Go(func() (err error) { overdue, err = s.repo.OverdueRequestCount(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		resolved, onTime, err = s.repo.SLAOutcomeCounts(gctx, tenantID, rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build performance kpis", err)
	}
	if s.facts != nil {
		if factHours, factSample, ferr := s.facts.AverageWorkingHours(ctx, tenantID, model.DurationFactRequestProcessing, filters); ferr == nil && factSample > 0 {
			avgProcHours = factHours
			procSample = factSample
		}
	}
	if factResolved, factOnTime, ferr := s.repo.DurationFactSLAOutcomeCounts(ctx, tenantID, rf); ferr == nil && factResolved > 0 {
		resolved = factResolved
		onTime = factOnTime
	}
	return &model.PerformanceKPIs{
		GeneratedAt:                s.now().UTC(),
		Filters:                    filters,
		AvgRequestProcessingHours:  round2(avgProcHours),
		RequestProcessingSample:    procSample,
		ClosedCaseRatio:            ratio(closedCases, totalCases),
		TotalCases:                 totalCases,
		ClosedCases:                closedCases,
		ApprovedContractRatio:      ratio(approved, totalContracts),
		TotalContracts:             totalContracts,
		ApprovedContracts:          approved,
		OverdueRequests:            overdue,
		EstimatedDurationAdherence: ratio(onTime, resolved),
		ResolvedClocks:             resolved,
		OnTimeClocks:               onTime,
	}, nil
}

// --- FLAGSHIP SLA compliance (CAP-151) -------------------------------------

func (s *ReportingService) SLACompliance(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters, quarters int) (*model.SLAComplianceReport, error) {
	return s.slaKPI.SLACompliance(ctx, tenantID, filters, quarters)
}

// --- consolidated dashboard ------------------------------------------------

func (s *ReportingService) LegalAffairsDashboard(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters) (*model.LegalAffairsDashboard, error) {
	// Only the unfiltered executive view is cached (the common case); a filtered
	// view always recomputes so ad-hoc slices are never served stale.
	cacheable := filters == (model.ReportFilters{})
	cacheKey := fmt.Sprintf("lex:reporting:legal-affairs:%s", tenantID)
	if cacheable && s.redis != nil {
		if payload, err := s.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			var cached model.LegalAffairsDashboard
			if err := json.Unmarshal(payload, &cached); err == nil {
				return &cached, nil
			}
		}
	}

	var (
		cases         *model.CaseReport
		contracts     *model.ContractAnalyticsReport
		consultations *model.ConsultationReport
		performance   *model.PerformanceKPIs
		slaCompliance *model.SLAComplianceReport
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { cases, err = s.CaseReport(gctx, tenantID, filters); return })
	g.Go(func() (err error) { contracts, err = s.ContractReport(gctx, tenantID, filters); return })
	g.Go(func() (err error) { consultations, err = s.ConsultationReport(gctx, tenantID, filters); return })
	g.Go(func() (err error) { performance, err = s.PerformanceKPIs(gctx, tenantID, filters); return })
	g.Go(func() (err error) { slaCompliance, err = s.SLACompliance(gctx, tenantID, filters, 4); return })
	if err := g.Wait(); err != nil {
		return nil, internalError("build legal-affairs dashboard", err)
	}

	currentRate := 0.0
	if len(slaCompliance.Quarters) > 0 {
		currentRate = slaCompliance.Quarters[len(slaCompliance.Quarters)-1].RatePct
	}
	dashboard := &model.LegalAffairsDashboard{
		GeneratedAt:        s.now().UTC(),
		Cases:              cases,
		Contracts:          contracts,
		Consultations:      consultations,
		Performance:        performance,
		SLACompliance:      slaCompliance,
		CurrentQuarterRate: currentRate,
	}
	if cacheable && s.redis != nil {
		if payload, err := json.Marshal(dashboard); err == nil {
			_ = s.redis.Set(ctx, cacheKey, payload, s.cacheTTL).Err()
		}
	}
	return dashboard, nil
}

func ratio(num, denom int) float64 {
	if denom <= 0 {
		return 0
	}
	return round4(float64(num) / float64(denom))
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100.0
}

func round4(v float64) float64 {
	return float64(int64(v*10000+0.5)) / 10000.0
}
