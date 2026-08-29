package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
)

type slaProcessor interface {
	ListTenantIDs(ctx context.Context) ([]uuid.UUID, error)
	ProcessDueClocks(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int) (service.SLAMonitorTenantResult, error)
}

// SLAMonitor is the background ticker that drives the SLA ack/breach/escalation
// state machine. It mirrors ExpiryMonitor (Run/RunOnce + ticker) and
// ComplianceMonitor (cross-tenant fan-out via ListTenantIDs). Each iteration scans
// every tenant's unresolved clocks, applies the idempotent state transitions,
// enqueues outbox rows, and emits com.clario360.lex.sla.* events. Delivery of the
// queued rows is a separate concern handled by SLAService.DispatchOutbox through
// the shared dispatcher seam.
type SLAMonitor struct {
	sla      slaProcessor
	interval time.Duration
	limit    int
	logger   zerolog.Logger
	now      func() time.Time
}

func NewSLAMonitor(sla slaProcessor, interval time.Duration, logger zerolog.Logger) *SLAMonitor {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	return &SLAMonitor{
		sla:      sla,
		interval: interval,
		limit:    500,
		logger:   logger.With().Str("component", "lex-sla-monitor").Logger(),
		now:      time.Now,
	}
}

func (m *SLAMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("sla monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("sla monitor iteration failed")
			}
		}
	}
}

func (m *SLAMonitor) RunOnce(ctx context.Context) error {
	if m.sla == nil {
		return fmt.Errorf("sla monitor service is not configured")
	}
	tenantIDs, err := m.sla.ListTenantIDs(ctx)
	if err != nil {
		return err
	}
	asOf := m.now().UTC()
	var errs []error
	for _, tenantID := range tenantIDs {
		if _, err := m.sla.ProcessDueClocks(ctx, tenantID, asOf, m.limit); err != nil {
			errs = append(errs, fmt.Errorf("tenant %s: %w", tenantID, err))
		}
	}
	return errors.Join(errs...)
}
