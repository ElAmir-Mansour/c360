package service

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/audit/dto"
	"github.com/clario360/platform/internal/audit/model"
	"github.com/clario360/platform/internal/audit/repository"
)

// IntegrityRunner periodically verifies the audit hash chain across all
// tenants and surfaces failures via metrics + structured logs.
//
// On-demand verification (the admin POST /verify endpoint) is necessary but
// not sufficient: tampering can sit undetected between manual checks. This
// runner closes that window without making the audit service tightly coupled
// to a cron container.
type IntegrityRunner struct {
	svc      *IntegrityService
	repo     *repository.AuditRepository
	interval time.Duration
	window   time.Duration
	logger   zerolog.Logger

	// last holds the most recent pass result so GET /integrity/status can return
	// it without recomputing. Guarded by mu; nil until the first pass completes.
	mu   sync.RWMutex
	last *dto.IntegrityStatusResponse
}

// LastStatus returns the most recent integrity-pass result, or nil if no pass
// has completed yet. The returned pointer is a snapshot and safe to serialize.
func (r *IntegrityRunner) LastStatus() *dto.IntegrityStatusResponse {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.last
}

// NewIntegrityRunner constructs a runner. interval is how often the full pass
// runs; window is how far back each pass scans (start = now - window). A small
// window (e.g. 24h) keeps each pass cheap; longer windows catch tampering of
// older entries at the cost of database I/O.
//
// If interval is zero or negative the runner is disabled — Start returns
// immediately so callers can wire it conditionally without branching.
func NewIntegrityRunner(svc *IntegrityService, repo *repository.AuditRepository, interval, window time.Duration, logger zerolog.Logger) *IntegrityRunner {
	return &IntegrityRunner{
		svc:      svc,
		repo:     repo,
		interval: interval,
		window:   window,
		logger:   logger.With().Str("component", "audit-integrity-runner").Logger(),
	}
}

// Start blocks until ctx is cancelled, running a verification pass every
// `interval`. The first pass runs immediately so misconfiguration surfaces at
// startup rather than `interval` later.
func (r *IntegrityRunner) Start(ctx context.Context) {
	if r.interval <= 0 {
		r.logger.Info().Msg("audit integrity runner disabled (interval<=0)")
		return
	}
	r.logger.Info().
		Dur("interval", r.interval).
		Dur("window", r.window).
		Msg("audit integrity runner started")

	r.runPass(ctx)

	t := time.NewTicker(r.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.runPass(ctx)
		}
	}
}

func (r *IntegrityRunner) runPass(ctx context.Context) {
	tenants, err := r.repo.ListTenantsWithEntries(ctx)
	if err != nil {
		r.logger.Error().Err(err).Msg("integrity pass: list tenants failed")
		return
	}
	end := time.Now().UTC()
	start := end.Add(-r.window)

	status := &dto.IntegrityStatusResponse{
		LastRunAt:    end.Format(time.RFC3339),
		WindowFrom:   start.Format(time.RFC3339),
		WindowTo:     end.Format(time.RFC3339),
		TenantsTotal: len(tenants),
		Results:      make([]dto.AdminVerifyResult, 0, len(tenants)),
	}

	for _, tenantID := range tenants {
		// Don't let one tenant block the whole pass on shutdown.
		if ctx.Err() != nil {
			return
		}
		result, err := r.svc.VerifyChain(ctx, tenantID, start, end)
		if err != nil {
			r.logger.Error().Err(err).Str("tenant_id", tenantID).Msg("integrity pass: verify failed")
			status.Results = append(status.Results, dto.AdminVerifyResult{
				TenantID: tenantID,
				Error:    err.Error(),
			})
			continue
		}
		status.Results = append(status.Results, verifyResultFor(tenantID, result))
		if !result.Verified {
			status.BrokenCount++
			// Already counted via metrics inside VerifyChain. Logged at WARN
			// here so an alert can fire on this distinctive line.
			r.logger.Warn().
				Str("tenant_id", tenantID).
				Int64("total_records", result.TotalRecords).
				Int64("verified_records", result.VerifiedRecords).
				Interface("broken_at", result.BrokenChainAt).
				Msg("audit hash chain BROKEN — investigate immediately")
		}
	}

	r.mu.Lock()
	r.last = status
	r.mu.Unlock()
}

// verifyResultFor adapts a single-tenant ChainVerificationResult into the
// cross-tenant AdminVerifyResult shape (adds tenant_id, flattens the rest).
func verifyResultFor(tenantID string, result *model.ChainVerificationResult) dto.AdminVerifyResult {
	return dto.AdminVerifyResult{
		TenantID:         tenantID,
		Verified:         result.Verified,
		TotalRecords:     result.TotalRecords,
		VerifiedRecords:  result.VerifiedRecords,
		BrokenChainAt:    result.BrokenChainAt,
		FirstRecord:      result.FirstRecord,
		LastRecord:       result.LastRecord,
		VerificationHash: result.VerificationHash,
		VerifiedAt:       result.VerifiedAt,
	}
}
