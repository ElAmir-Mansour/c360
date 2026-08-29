package service

import (
	"context"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ResolutionRateService computes tenant-scoped resolution rates across the four
// legal-affairs domains (contracts, litigation, advisory, requests) from COUNT
// queries. Each domain's rate = round(resolved / total * 100), and 0 when total
// is 0. The eight counts fan out with an errgroup (mirroring
// ReportingService.PerformanceKPIs). This service performs NO writes.
type ResolutionRateService struct {
	repo   *repository.ReportingRepository
	logger zerolog.Logger
	now    func() time.Time
}

func NewResolutionRateService(repo *repository.ReportingRepository, logger zerolog.Logger) *ResolutionRateService {
	return &ResolutionRateService{
		repo:   repo,
		logger: logger.With().Str("service", "lex-resolution-rate").Logger(),
		now:    time.Now,
	}
}

// ResolutionRates fans out the eight tenant-scoped counts and assembles the
// fixed-order category list.
func (s *ResolutionRateService) ResolutionRates(ctx context.Context, tenantID uuid.UUID) (*model.ResolutionRateReport, error) {
	// Empty filter — ReportFilter fields are unexported, so it MUST be built via
	// NewReportFilter. This yields an unfiltered, portfolio-wide count per domain.
	rf := repository.NewReportFilter(model.ReportFilters{})
	var (
		contractsTotal    int
		contractsResolved int
		casesTotal        int
		casesResolved     int
		advisoryTotal     int
		advisoryResolved  int
		requestsTotal     int
		requestsResolved  int
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { contractsTotal, err = s.repo.ContractTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { contractsResolved, err = s.repo.ContractResolvedCount(gctx, tenantID, rf); return })
	g.Go(func() (err error) { casesTotal, err = s.repo.CaseTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) { casesResolved, err = s.repo.CaseStatusCount(gctx, tenantID, "closed", rf); return })
	g.Go(func() (err error) { advisoryTotal, err = s.repo.ConsultationTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		advisoryResolved, err = s.repo.ConsultationResolvedCount(gctx, tenantID, rf)
		return
	})
	g.Go(func() (err error) { requestsTotal, err = s.repo.LegalRequestTotal(gctx, tenantID, rf); return })
	g.Go(func() (err error) {
		requestsResolved, err = s.repo.LegalRequestResolvedCount(gctx, tenantID, rf)
		return
	})
	if err := g.Wait(); err != nil {
		return nil, internalError("build resolution-rate report", err)
	}
	return buildResolutionRateReport(
		[]model.ResolutionRateCategory{
			{Key: "contracts", Total: contractsTotal, Resolved: contractsResolved},
			{Key: "litigation", Total: casesTotal, Resolved: casesResolved},
			{Key: "advisory", Total: advisoryTotal, Resolved: advisoryResolved},
			{Key: "requests", Total: requestsTotal, Resolved: requestsResolved},
		},
		s.now().UTC(),
	), nil
}

// buildResolutionRateReport fills each category's Rate from its total/resolved
// and stamps CalculatedAt. Kept as a pure function so the rounding and
// zero-total behaviour are unit-testable without a database.
func buildResolutionRateReport(categories []model.ResolutionRateCategory, calculatedAt time.Time) *model.ResolutionRateReport {
	out := make([]model.ResolutionRateCategory, len(categories))
	for i, c := range categories {
		c.Rate = resolutionPct(c.Resolved, c.Total)
		out[i] = c
	}
	return &model.ResolutionRateReport{Categories: out, CalculatedAt: calculatedAt}
}

// resolutionPct returns round(resolved/total*100), or 0 when total <= 0.
func resolutionPct(resolved, total int) int {
	if total <= 0 {
		return 0
	}
	return int(math.Round(float64(resolved) / float64(total) * 100))
}
